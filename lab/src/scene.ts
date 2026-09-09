import { hermiteMag, outlinePath } from "rescrawl/svg";
import type { Contact, Point4 } from "rescrawl/types";
import { isFitNode } from "./analyze";
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

// `pts` are the editable input discs, `nodes` what the engine kept of them
// (drawn discs, spokes and the spine are the nodes'), `spine` the centerline
// as the engine reads its nodes.
export function scene(
  state: State,
  pts: Point4[],
  nodes: Point4[],
  cs: Contact[],
  an: Analysis,
  k: number,
  spine: string,
): string {
  const s = state.show;
  const n = cs.length;
  const step = state.step < 0 || state.step > n ? n : state.step;
  const partial = step < n;
  const dropped = new Set(an.dropped);
  const out: string[] = [];

  // --- the shape itself, as `outlinePath` will actually emit it ---
  if (s.fill && n > 1) {
    const d = outlinePath(cs, 3);
    out.push(
      `<path class="fill" d="${d}" fill-rule="${s.evenodd ? "evenodd" : "nonzero"}"/>`,
      `<path class="fillEdge" d="${d}" vector-effect="non-scaling-stroke"/>`,
    );
  }

  // --- the discs the envelope is wrapped around; dropped ones ghosted ---
  if (s.discs)
    pts.forEach((p, i) =>
      out.push(
        `<circle class="disc${state.sel === i ? " sel" : ""}${dropped.has(i) ? " dropped" : ""}" cx="${f(p.x)}" cy="${f(p.y)}" r="${f(p.r)}" vector-effect="non-scaling-stroke"/>`,
      ),
    );

  // --- what the engine builds from ---
  // Polyline engines: the external tangent lines of each segment. Fit: each
  // node's in/out tangent as the Bezier handles the spine is drawn with, and
  // a box on every detected corner.
  if (s.tangents) {
    if (an.nodeRows) {
      nodes.forEach((p) => {
        if (!isFitNode(p)) return;
        const ki = p.mi / 3;
        const ko = p.mo / 3;
        if (ki > 0)
          out.push(
            `<line class="ntan in" x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(p.x - p.ix * ki)}" y2="${f(p.y - p.iy * ki)}" vector-effect="non-scaling-stroke"/>`,
          );
        if (ko > 0)
          out.push(
            `<line class="ntan out" x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(p.x + p.ox * ko)}" y2="${f(p.y + p.oy * ko)}" marker-end="url(#arw)" vector-effect="non-scaling-stroke"/>`,
          );
        if (p.corner) {
          const h = 5 * k;
          out.push(
            `<rect class="corner" x="${f(p.x - h)}" y="${f(p.y - h)}" width="${f(2 * h)}" height="${f(2 * h)}" vector-effect="non-scaling-stroke"/>`,
          );
        }
      });
    } else
      an.segs.forEach((seg) => {
        const a = nodes[seg.i];
        const b = nodes[seg.i + 1];
        for (const side of [1, -1] as const) {
          const ang = seg.thru + side * seg.off;
          const cos = Math.cos(ang),
            sin = Math.sin(ang);
          out.push(
            `<line class="tangent" x1="${f(a.x + a.r * cos)}" y1="${f(a.y + a.r * sin)}" x2="${f(b.x + b.r * cos)}" y2="${f(b.y + b.r * sin)}" vector-effect="non-scaling-stroke"/>`,
          );
        }
      });
  }

  // --- centreline, as the engine reads its nodes ---
  if (s.centerline && nodes.length > 1)
    out.push(`<path class="center" d="${spine}" vector-effect="non-scaling-stroke"/>`);

  // --- the contact loop as straight hops: shows spacing and traversal ---
  if (s.polygon && n > 1)
    out.push(
      `<polyline class="poly" points="${poly(cs, partial ? step : n)}${partial ? "" : ` ${f(cs[0].x)},${f(cs[0].y)}`}" vector-effect="non-scaling-stroke"/>`,
    );

  // --- one spoke per contact, centre -> contact: this is the angle ---
  // Only for contacts that actually lie on their node's disc: an envelope
  // sample's nearest node is not the centre it was struck from, so a spoke
  // to it would be a line with no meaning.
  if (s.radii)
    cs.slice(0, step).forEach((c, i) => {
      if (an.info[i].kind === "sample") return;
      const p = nodes[an.info[i].owner];
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
      // Same rule as `outlinePath`: a side's own magnitude, else the shared
      // one, else the chord rule.
      const ka = (c.mIn ?? c.m ?? hermiteMag(prev, c)) / 3;
      const kb = (c.mOut ?? c.m ?? hermiteMag(c, next)) / 3;
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
    const gone = dropped.has(i) ? " dropped" : "";
    out.push(
      `<circle class="ptHit" data-pt="${i}" cx="${f(p.x)}" cy="${f(p.y)}" r="${f(9 * k)}"/>`,
      `<circle class="pt${state.sel === i ? " sel" : ""}${hovPt ? " hov" : ""}${gone}" cx="${f(p.x)}" cy="${f(p.y)}" r="${f(4 * k)}" vector-effect="non-scaling-stroke"/>`,
      `<text class="plabel${gone}" x="${f(p.x + 7 * k)}" y="${f(p.y + 14 * k)}" font-size="${f(11 * k)}">P${i}</text>`,
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
