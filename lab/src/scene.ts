import { hermiteMag, outlinePath } from "rescrawl/svg";
import type { Contact, Point4 } from "rescrawl/types";
import type { Analysis } from "./analyze";
import type { Hover, State } from "./state";

// Everything is drawn in world units inside one viewBox, so a handle that must
// stay the same size on screen is sized in `k` = world units per pixel.

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

const hue = (t: number) => `hsl(${Math.round(20 + 300 * t)} 85% 62%)`;

function poly(cs: Contact[], upto: number): string {
  return cs
    .slice(0, upto)
    .map((c) => `${f(c.x)},${f(c.y)}`)
    .join(" ");
}

export function scene(state: State, pts: Point4[], cs: Contact[], an: Analysis, k: number): string {
  const s = state.show;
  const n = cs.length;
  const step = state.step < 0 || state.step > n ? n : state.step;
  const partial = step < n;
  const out: string[] = [];

  // --- the shape itself, as `outlinePath` will actually emit it ---
  if (s.fill && n > 1) {
    const d = outlinePath(cs, 3);
    out.push(
      `<path class="fill" d="${d}" fill-rule="${s.evenodd ? "evenodd" : "nonzero"}"/>`,
      `<path class="fillEdge" d="${d}" vector-effect="non-scaling-stroke"/>`,
    );
  }

  // --- the discs the envelope is wrapped around ---
  if (s.discs)
    pts.forEach((p, i) =>
      out.push(
        `<circle class="disc${state.sel === i ? " sel" : ""}" cx="${f(p.x)}" cy="${f(p.y)}" r="${f(p.r)}" vector-effect="non-scaling-stroke"/>`,
      ),
    );

  // --- the external tangent lines each segment is built from ---
  if (s.tangents)
    an.segs.forEach((seg) => {
      const a = pts[seg.i];
      const b = pts[seg.i + 1];
      for (const side of [1, -1] as const) {
        const ang = seg.thru + side * seg.off;
        const cos = Math.cos(ang),
          sin = Math.sin(ang);
        out.push(
          `<line class="tangent" x1="${f(a.x + a.r * cos)}" y1="${f(a.y + a.r * sin)}" x2="${f(b.x + b.r * cos)}" y2="${f(b.y + b.r * sin)}" vector-effect="non-scaling-stroke"/>`,
        );
      }
    });

  // --- centreline ---
  if (s.centerline && pts.length > 1)
    out.push(
      `<polyline class="center" points="${pts.map((p) => `${f(p.x)},${f(p.y)}`).join(" ")}" vector-effect="non-scaling-stroke"/>`,
    );

  // --- the contact loop as straight hops: shows spacing and traversal ---
  if (s.polygon && n > 1)
    out.push(
      `<polyline class="poly" points="${poly(cs, partial ? step : n)}${partial ? "" : ` ${f(cs[0].x)},${f(cs[0].y)}`}" vector-effect="non-scaling-stroke"/>`,
    );

  // --- one spoke per contact, centre -> contact: this is the angle ---
  if (s.radii)
    cs.slice(0, step).forEach((c, i) => {
      const p = pts[an.info[i].owner];
      out.push(
        `<line class="spoke" x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(c.x)}" y2="${f(c.y)}" stroke="${hue(n < 2 ? 0 : i / (n - 1))}" vector-effect="non-scaling-stroke"/>`,
      );
    });

  // --- stored unit tangents, and the control handles `outlinePath` derives ---
  if (s.tangentDirs)
    cs.slice(0, step).forEach((c, i) => {
      const L = 14 * k;
      out.push(
        `<line class="dir" x1="${f(c.x)}" y1="${f(c.y)}" x2="${f(c.x + c.tx * L)}" y2="${f(c.y + c.ty * L)}" marker-end="url(#arw)" vector-effect="non-scaling-stroke"/>`,
      );
      const prev = cs[(i + n - 1) % n];
      const next = cs[(i + 1) % n];
      const ka = (c.m ?? hermiteMag(prev, c)) / 3;
      const kb = (c.m ?? hermiteMag(c, next)) / 3;
      out.push(
        `<line class="handle" x1="${f(c.x - c.tx * ka)}" y1="${f(c.y - c.ty * ka)}" x2="${f(c.x + c.tx * kb)}" y2="${f(c.y + c.ty * kb)}" vector-effect="non-scaling-stroke"/>`,
      );
    });

  // --- the contacts, in traversal order ---
  if (s.contacts)
    cs.slice(0, step).forEach((c, i) => {
      const inf = an.info[i];
      const isHover = state.hover?.kind === "contact" && state.hover.i === i;
      const isCur = partial && i === step - 1;
      const big = inf.kind === "primary" || inf.kind === "joint";
      const r = (isCur ? 6 : isHover ? 5.5 : big ? 4 : 2.6) * k;
      const cls = `contact ${inf.kind}${isCur ? " cur" : ""}${isHover ? " hov" : ""}${inf.dupPrev ? " dup" : ""}`;
      out.push(
        `<circle class="${cls}" data-c="${i}" cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="${hue(n < 2 ? 0 : i / (n - 1))}" vector-effect="non-scaling-stroke"/>`,
      );
      if (s.labels && (big || isCur || isHover))
        out.push(
          `<text class="clabel" x="${f(c.x + 8 * k)}" y="${f(c.y - 6 * k)}" font-size="${f(11 * k)}">${i}</text>`,
        );
    });

  // --- where the loop eats itself ---
  if (s.crossings)
    an.crossings.forEach((x) => {
      const r = 5 * k;
      out.push(
        `<path class="cross" d="M${f(x.x - r)} ${f(x.y - r)}L${f(x.x + r)} ${f(x.y + r)}M${f(x.x - r)} ${f(x.y + r)}L${f(x.x + r)} ${f(x.y - r)}" vector-effect="non-scaling-stroke"/>`,
      );
    });

  // --- handles, always on top ---
  pts.forEach((p, i) => {
    const hovPt = state.hover?.kind === "point" && state.hover.i === i;
    out.push(
      `<circle class="ptHit" data-pt="${i}" cx="${f(p.x)}" cy="${f(p.y)}" r="${f(9 * k)}"/>`,
      `<circle class="pt${state.sel === i ? " sel" : ""}${hovPt ? " hov" : ""}" cx="${f(p.x)}" cy="${f(p.y)}" r="${f(4 * k)}" vector-effect="non-scaling-stroke"/>`,
      `<text class="plabel" x="${f(p.x + 7 * k)}" y="${f(p.y + 14 * k)}" font-size="${f(11 * k)}">P${i}</text>`,
    );
    // radius handle, parked at 45deg off the disc
    const hx = p.x + p.r * Math.SQRT1_2;
    const hy = p.y - p.r * Math.SQRT1_2;
    out.push(
      `<circle class="ringHit" data-ring="${i}" cx="${f(hx)}" cy="${f(hy)}" r="${f(9 * k)}"/>`,
      `<circle class="ring" cx="${f(hx)}" cy="${f(hy)}" r="${f(4 * k)}" vector-effect="non-scaling-stroke"/>`,
    );
  });

  return `<defs><marker id="arw" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L6 3L0 6z" fill="#7dd3fc"/></marker></defs>${out.join("")}`;
}

export type { Hover };
