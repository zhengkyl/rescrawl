import { chordRule, dist } from "./math.ts";
import type { CenterlineNode } from "./centerline/fit.ts";
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

// The chord rule between two contacts -- see `chordRule`.
export function hermiteMag(a: OutlineNode, b: OutlineNode): number {
  return chordRule(dist(a, b), a.tx, a.ty, b.tx, b.ty);
}

// The fitted centerline as it was fitted: a line where the fit said line, a
// cubic on the stored tangents where it said cubic. Unlike `centerlinePath`,
// this one is faithful. The engines do not return it -- a consumer that wants
// the centerline as path data (the debug views, and nothing else) calls this.
export function fitPath(ns: CenterlineNode[], digits = DEFAULT_DIGITS): string {
  if (ns.length === 0) return "";
  const pen = new Pen(digits);
  pen.moveTo(ns[0].x, ns[0].y);
  for (let i = 1; i < ns.length; i++) {
    const a = ns[i - 1];
    const b = ns[i];
    if (a.mo === 0 && b.mi === 0) {
      pen.lineTo(b.x, b.y);
      continue;
    }
    const ka = a.mo / 3;
    const kb = b.mi / 3;
    pen.curveTo(a.x + a.ox * ka, a.y + a.oy * ka, b.x - b.ix * kb, b.y - b.iy * kb, b.x, b.y);
  }
  return pen.toString();
}

// One cubic per pair. Each end's Hermite tangent is the stored unit tangent
// scaled by the contact's own magnitude for that side if it has one (`mOut`
// leaving, `mIn` arriving, `m` for either), else by the chord rule. Bezier
// control points sit at a third of the Hermite tangent.
export function outlinePath(cs: OutlineNode[], digits = DEFAULT_DIGITS): string {
  const n = cs.length;
  if (n < 2) return "";
  const pen = new Pen(digits);
  pen.moveTo(cs[0].x, cs[0].y);
  for (let i = 0; i < n; i++) {
    const a = cs[i],
      b = cs[(i + 1) % n];
    const m = hermiteMag(a, b);
    const ka = (a.mOut ?? a.m ?? m) / 3;
    const kb = (b.mIn ?? b.m ?? m) / 3;
    pen.curveTo(a.x + a.tx * ka, a.y + a.ty * ka, b.x - b.tx * kb, b.y - b.ty * kb, b.x, b.y);
  }
  pen.close();
  return pen.toString();
}
