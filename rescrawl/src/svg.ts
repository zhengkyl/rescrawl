import type { CubicNode } from "./centerline/fit.ts";
import type { Point2 } from "./math.ts";
import type { OutlineNode } from "./Outline.ts";

// relative commands, implied repeats, shortest numbers, dropped separators
// coordinates are whole grid steps (10^-digits), so deltas don't drift
class Pen {
  private out = "";
  private cmd = "";
  private x = 0;
  private y = 0;
  private startX = 0;
  private startY = 0;
  private sep = false;
  private dotted = false;

  private digits: number;
  private k: number;

  constructor(digits: number) {
    this.digits = digits;
    this.k = Math.pow(10, digits);
  }

  private word(cmd: string) {
    if (cmd === this.cmd) return;
    this.out += cmd;
    this.cmd = cmd;
    this.sep = false;
  }

  private write(n: number) {
    const a = Math.abs(n);
    const whole = Math.floor(a / this.k);
    let frac = a - whole * this.k;
    let s = whole > 0 || frac === 0 ? String(whole) : "";
    if (frac > 0) {
      let width = this.digits;
      while (frac % 10 === 0) {
        frac /= 10;
        width--;
      }
      s += "." + String(frac).padStart(width, "0");
    }
    // "1.5.5" parses as two numbers, "12" ".5" would fuse into "12.5"
    if (n < 0) this.out += "-";
    else if (this.sep && !(s[0] === "." && this.dotted)) this.out += " ";
    this.out += s;
    this.sep = true;
    this.dotted = frac > 0;
  }

  private point(x: number, y: number) {
    this.write(Math.round(x * this.k) - this.x);
    this.write(Math.round(y * this.k) - this.y);
  }

  private move(x: number, y: number) {
    this.x = Math.round(x * this.k);
    this.y = Math.round(y * this.k);
  }

  moveTo(x: number, y: number) {
    this.word("m");
    this.point(x, y);
    this.move(x, y);
    this.startX = this.x;
    this.startY = this.y;
  }

  lineTo(x: number, y: number) {
    if (Math.round(x * this.k) === this.x && Math.round(y * this.k) === this.y) return;
    this.word("l");
    this.point(x, y);
    this.move(x, y);
  }

  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    this.word("c");
    this.point(c1x, c1y);
    this.point(c2x, c2y);
    this.point(x, y);
    this.move(x, y);
  }

  close() {
    this.out += "z";
    this.x = this.startX;
    this.y = this.startY;
    this.cmd = "";
    this.sep = false;
  }

  toString() {
    return this.out;
  }
}

const DEFAULT_DIGITS = 1;

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

// each piece is its own closed subpath
export function outlineCubicPath(pieces: OutlineNode[][], digits = DEFAULT_DIGITS): string {
  const pen = new Pen(digits);
  for (const cs of pieces) {
    const n = cs.length;
    if (n < 2) continue;
    pen.moveTo(cs[0].x, cs[0].y);
    for (let i = 0; i < n; i++) {
      const a = cs[i];
      const b = cs[(i + 1) % n];
      // first handle on its own point: a straight stretch
      if (a.c1x === a.x && a.c1y === a.y) pen.lineTo(b.x, b.y);
      else pen.curveTo(a.c1x, a.c1y, a.c2x, a.c2y, b.x, b.y);
    }
    pen.close();
  }
  return pen.toString();
}
