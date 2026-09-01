import { clamp11, dist } from "./math";
import type { Contact, Point2 } from "./types";

// --- path emission ---
//
// Path data is the bulk of any SVG this produces, so it is emitted through one
// small builder that applies the four standard size wins at once. All four are
// exact-or-better than what they replace; none of them is a quality tradeoff
// beyond the declared `digits`.
//
//   relative commands   `l 2.4 1.1` instead of `L 481.6 320.7`. Deltas between
//                       adjacent points are one or two digits where absolute
//                       coordinates are four or five.
//   implied commands    a repeated command letter may be dropped, so a polyline
//                       is one `l` followed by bare number pairs.
//   trimmed numbers     no trailing zeros, no leading zero on `.5`, `-0` is `0`.
//   dropped separators  a number starting with `-` or `.` already terminates the
//                       previous one, so the space between them is not needed.
//
// Relative commands have one trap: rounding each delta on its own lets error
// accumulate along the path, since every delta is measured from a position the
// parser will never actually be at. So the builder tracks the position AS THE
// PARSER WILL SEE IT -- the running sum of the rounded deltas -- and measures
// each new delta from there. Error then stays inside half a grid step for the
// whole path instead of drifting with its length.

// Rounded onto a decimal grid; dividing by a power of ten lands on the nearest
// double to that decimal, so it also serializes as the shortest such string.
const snap = (v: number, digits: number) => {
  const k = Math.pow(10, digits);
  return Math.round(v * k) / k;
};

export function trimNum(n: number, digits: number): string {
  let s = n.toFixed(digits);
  if (digits > 0 && s.indexOf(".") >= 0) s = s.replace(/\.?0+$/, "");
  if (s === "-0" || s === "") s = "0";
  if (s.startsWith("0.")) s = s.slice(1);
  else if (s.startsWith("-0.")) s = "-" + s.slice(2);
  return s;
}

class Pen {
  private out = "";
  private cx = 0; // current point as the PARSER will compute it
  private cy = 0;
  private cmd = ""; // last command letter written, for implied repeats
  private sep = false; // does the next number need a separator?
  private dotted = false; // did the last number already spend its "."?

  constructor(private digits: number) {}

  private word(cmd: string) {
    if (cmd === this.cmd) return;
    this.out += cmd;
    this.cmd = cmd;
    this.sep = false;
  }

  private write(n: number) {
    const s = trimNum(n, this.digits);
    // "1.5.5" is unambiguously two numbers, but "12" then ".5" would fuse into
    // "12.5" -- so a leading "." only replaces the separator when the previous
    // number has a "." of its own to terminate it.
    if (this.sep && s[0] !== "-" && !(s[0] === "." && this.dotted)) this.out += " ";
    this.out += s;
    this.sep = true;
    this.dotted = s.indexOf(".") >= 0;
  }

  moveTo(x: number, y: number) {
    const dx = snap(x - this.cx, this.digits);
    const dy = snap(y - this.cy, this.digits);
    this.word("m");
    this.write(dx);
    this.write(dy);
    this.cx += dx;
    this.cy += dy;
  }

  // A delta that rounds to nothing is dropped: it moves the pen nowhere and
  // costs four bytes to say so.
  lineTo(x: number, y: number) {
    const dx = snap(x - this.cx, this.digits);
    const dy = snap(y - this.cy, this.digits);
    if (dx === 0 && dy === 0) return;
    this.word("l");
    this.write(dx);
    this.write(dy);
    this.cx += dx;
    this.cy += dy;
  }

  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    const dx = snap(x - this.cx, this.digits);
    const dy = snap(y - this.cy, this.digits);
    this.word("c");
    this.write(snap(c1x - this.cx, this.digits));
    this.write(snap(c1y - this.cy, this.digits));
    this.write(snap(c2x - this.cx, this.digits));
    this.write(snap(c2y - this.cy, this.digits));
    this.write(dx);
    this.write(dy);
    this.cx += dx;
    this.cy += dy;
  }

  close() {
    this.out += "z";
    this.cmd = "";
    this.sep = false;
  }

  toString() {
    return this.out;
  }
}

const DEFAULT_DIGITS = 1;

// The centerline as a bare polyline. Straight segments between points is not an
// approximation the animator has to apologise for: this path is never painted
// visibly, only used as the spine of the reveal, and it is what the arc-length
// timing is measured along.
export function centerlinePath(pts: Point2[], digits = DEFAULT_DIGITS): string {
  if (pts.length === 0) return "";
  const pen = new Pen(digits);
  pen.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) pen.lineTo(pts[i].x, pts[i].y);
  return pen.toString();
}

// One cubic per pair. Hermite tangents are the stored unit tangents scaled by
// the chord times `sec²(turn/4)` — the factor that makes a cubic reproduce a
// circular arc of that turn. It is 1 when the tangents are parallel, so a
// straight run emits its chord exactly, and 1.172 across a quarter turn.
//
// Bezier control points sit at a third of the Hermite tangent, so the scale is
// folded into `k` once and used on both ends.
export function outlinePath(cs: Contact[], digits = DEFAULT_DIGITS): string {
  const n = cs.length;
  if (n < 2) return "";
  const pen = new Pen(digits);
  pen.moveTo(cs[0].x, cs[0].y);
  for (let i = 0; i < n; i++) {
    const a = cs[i],
      b = cs[(i + 1) % n];
    // cos(turn/2) by half angle, so sec²(turn/4) needs no trig of its own.
    const half = Math.sqrt((1 + clamp11(a.tx * b.tx + a.ty * b.ty)) / 2);
    const k = (dist(a, b) * 2) / (3 * (1 + half));
    pen.curveTo(a.x + a.tx * k, a.y + a.ty * k, b.x - b.tx * k, b.y - b.ty * k, b.x, b.y);
  }
  pen.close();
  return pen.toString();
}
