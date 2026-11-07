import { quadControl } from "./math.ts";
import type { CubicNode } from "./centerline/fit.ts";
import type { Point2 } from "./math.ts";
import type { OutlineNode } from "./outline/contact.ts";

// One builder for all path data, applying the standard size wins: relative
// commands, implied repeats, trimmed numbers, dropped separators. All are
// exact-or-better beyond the declared `digits`.
//
// The trap in relative commands: rounding each delta on its own accumulates
// error, since every delta is measured from a position the parser is never
// actually at. So the builder tracks the position AS THE PARSER SEES IT -- the
// running sum of rounded deltas -- keeping error inside half a grid step for
// the whole path instead of drifting with its length.

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
  private sx = 0; // subpath start, where `z` leaves the parser
  private sy = 0;
  private qx = 0; // last quadratic control point, as the parser holds it
  private qy = 0;
  private sep = false; // does the next number need a separator?
  private dotted = false; // did the last number already spend its "."?

  private digits: number;

  constructor(digits: number) {
    this.digits = digits;
  }

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
    this.sx = this.cx;
    this.sy = this.cy;
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

  // `t` reflects the previous control point through the current point, so it
  // spends two numbers where `q` spends four. It is taken only when that
  // reflection lands on the very same grid point the explicit control would
  // have been written to -- the shorthand is a saving, never an approximation.
  quadTo(cx: number, cy: number, x: number, y: number) {
    const dcx = snap(cx - this.cx, this.digits);
    const dcy = snap(cy - this.cy, this.digits);
    const dx = snap(x - this.cx, this.digits);
    const dy = snap(y - this.cy, this.digits);
    const smooth =
      (this.cmd === "q" || this.cmd === "t") &&
      snap(this.cx - this.qx, this.digits) === dcx &&
      snap(this.cy - this.qy, this.digits) === dcy;
    if (smooth) {
      this.word("t");
    } else {
      this.word("q");
      this.write(dcx);
      this.write(dcy);
    }
    this.write(dx);
    this.write(dy);
    this.qx = this.cx + dcx;
    this.qy = this.cy + dcy;
    this.cx += dx;
    this.cy += dy;
  }

  close() {
    this.out += "z";
    this.cx = this.sx;
    this.cy = this.sy;
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

export function fitPath(ns: CubicNode[], digits = DEFAULT_DIGITS): string {
  if (ns.length === 0) return "";
  const pen = new Pen(digits);
  pen.moveTo(ns[0].x, ns[0].y);
  for (let i = 1; i < ns.length; i++) {
    const a = ns[i - 1];
    const b = ns[i];
    pen.curveTo(a.c1x, a.c1y, a.c2x, a.c2y, b.x, b.y);
  }
  return pen.toString();
}

// One quadratic per pair of contacts, its control point where their tangent
// lines cross -- see `quadControl`. A pair whose tangents cannot meet ahead
// falls back to a line. Each piece is its own closed subpath.
export function outlineQuadPath(pieces: OutlineNode[][], digits = DEFAULT_DIGITS): string {
  const pen = new Pen(digits);
  for (const cs of pieces) {
    const n = cs.length;
    if (n < 2) continue;
    pen.moveTo(cs[0].x, cs[0].y);
    for (let i = 0; i < n; i++) {
      const a = cs[i],
        b = cs[(i + 1) % n];
      const q = quadControl(a.x, a.y, a.tx, a.ty, b.x, b.y, b.tx, b.ty);
      if (q === null) pen.lineTo(b.x, b.y);
      else pen.quadTo(q.x, q.y, b.x, b.y);
    }
    pen.close();
  }
  return pen.toString();
}
