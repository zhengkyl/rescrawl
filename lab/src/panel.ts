import { outlinePath } from "rescrawl/svg";
import type { Contact, Point4 } from "rescrawl/types";
import type { Analysis } from "./analyze";
import type { State } from "./state";

const deg = (a: number) => `${((a * 180) / Math.PI).toFixed(1)}°`;
const num = (n: number, d = 1) => n.toFixed(d);

const SIDE = { 1: "L", "-1": "R", 0: "–" } as const;

// The magnitude column: a shared `m`, a per-side pair, or the chord rule.
function mag(c: Contact): string {
  if (c.mIn !== undefined || c.mOut !== undefined)
    return `${c.mIn === undefined ? "·" : num(c.mIn)} → ${c.mOut === undefined ? "·" : num(c.mOut)}`;
  return c.m === undefined ? "chord" : num(c.m);
}

export function diagnostics(
  state: State,
  pts: Point4[],
  nodes: Point4[],
  cs: Contact[],
  an: Analysis,
): string {
  const P = (node: number) => `P${an.ptOf[node]}`;
  const warn: string[] = [];
  for (const s of an.segs)
    if (s.contained)
      warn.push(
        `${P(s.i)}–${P(s.i + 1)}: |Δr| ${num(Math.abs(s.dr), 2)} > d ${num(s.d, 2)} — one disc contains the other, no external tangent exists. Every engine assumes <code>dropContained</code> already removed this.`,
      );
  const dups = an.info.filter((i) => i.dupPrev).length;
  if (dups) warn.push(`${dups} contact(s) coincide with the one before them.`);
  const offDisc = an.info.filter((i) => i.kind === "off-disc").length;
  if (offDisc && !state.opts.cornerPoint)
    warn.push(`${offDisc} contact(s) do not lie on any disc.`);
  const perp = an.info.reduce((m, i) => Math.max(m, Math.abs(i.perpErr)), 0);
  if (perp > 1e-9)
    warn.push(`tangent is not perpendicular to the radius (max ${perp.toExponential(1)}).`);

  const prim = an.info.filter((i) => i.kind === "primary" || i.kind === "joint").length;
  const samples = an.info.filter((i) => i.kind === "sample").length;

  const summary = `
    <table class="kv">
      <tr><td>points</td><td>${pts.length}</td></tr>
      <tr><td>nodes</td><td>${nodes.length}${an.dropped.length ? ` <span class="dim">(dropped P${an.dropped.join(", P")})</span>` : ""}</td></tr>
      <tr><td>contacts</td><td>${cs.length} <span class="dim">(${prim} node, ${samples ? `${samples} envelope sample, ` : ""}${cs.length - prim - samples} arc)</span></td></tr>
      <tr><td>self-crossings</td><td class="${an.crossings.length ? "br-fold" : "dim"}">${an.crossings.length}<span class="dim">${an.crossings.length ? " — folds" : ""}</span></td></tr>
      <tr><td>signed area</td><td>${num(an.area, 1)} <span class="dim">${an.area < 0 ? "cw" : "ccw"}</span></td></tr>
      <tr><td>path (1 digit)</td><td>${outlinePath(cs, 1).length} chars</td></tr>
    </table>`;

  // What the engine builds from: the fit's per-node tangents, or the
  // polyline's per-segment tangent lines.
  const built = an.nodeRows
    ? `<h2>nodes <span class="dim">mirrored</span></h2>
      <table class="tbl">
        <tr><th>pt</th><th>in</th><th>out</th><th>off</th><th>mi</th><th>mo</th><th>dr/ds</th></tr>
        ${an.nodeRows
          .map(
            (r) =>
              `<tr class="${r.corner ? "br-fold" : ""}"><td>${P(r.i)}${r.corner ? " ∟" : ""}</td><td>${deg(r.angIn)}</td><td>${deg(r.angOut)}</td><td>${deg(r.off)}</td><td>${num(r.mi)}</td><td>${num(r.mo)}</td><td>${num(r.slope, 3)}</td></tr>`,
          )
          .join("")}
      </table>
      <p class="hint">
        <b>in</b>/<b>out</b> the node's tangents; they differ only at a corner (∟).
        <b>off</b> how far each contact tilts back from the normal, from the radius slope.
        <b>mi</b>/<b>mo</b> Hermite magnitudes of the cubics arriving and leaving; 0 is the tail's chord rule.
      </p>`
    : an.segs.length
      ? `<h2>segments <span class="dim">mirrored</span></h2>
      <table class="tbl">
        <tr><th>i</th><th>d</th><th>Δr</th><th>thru</th><th>off</th></tr>
        ${an.segs
          .map(
            (s) =>
              `<tr class="${s.contained ? "bad" : ""}"><td>${P(s.i)}→${P(s.i + 1)}</td><td>${num(s.d)}</td><td>${num(s.dr)}</td><td>${deg(s.thru)}</td><td>${deg(s.off)}</td></tr>`,
          )
          .join("")}
      </table>`
      : "";

  const joints = an.joints.length
    ? `<h2>joints <span class="dim">mirrored</span></h2>
      <table class="tbl">
        <tr><th>pt</th><th>side</th><th>from</th><th>to</th><th>turn</th><th>branch</th></tr>
        ${an.joints
          .map(
            (j) =>
              `<tr><td>${P(j.i)}</td><td>${SIDE[j.side]}</td><td>${deg(j.from)}</td><td>${deg(j.to)}</td><td>${deg(j.turn)}</td><td class="br-${j.branch}">${j.branch}</td></tr>`,
          )
          .join("")}
      </table>
      <p class="hint">
        <b>sweep</b> the outer side of the bend, an arc is pushed between the two angles.
        <b>fold</b> the inner side, the contacts cross over (or collapse to one corner point) and nonzero winding fills it.
        <b>flat</b> no turn worth a second contact.
      </p>`
    : "";

  const rows = cs
    .map((c, i) => {
      const inf = an.info[i];
      const hov = state.hover?.kind === "contact" && state.hover.i === i;
      const cur = state.step >= 0 && state.step === i + 1;
      return `<tr class="crow${hov ? " hov" : ""}${cur ? " cur" : ""}${inf.dupPrev ? " bad" : ""}" data-c="${i}">
        <td>${i}</td><td>${P(inf.owner)}</td><td>${SIDE[inf.side]}</td>
        <td>${deg(inf.angle)}</td><td class="${inf.kind}">${inf.kind}</td>
        <td>${num(c.x)}</td><td>${num(c.y)}</td><td class="dim">${mag(c)}</td></tr>`;
    })
    .join("");

  return `
    ${warn.length ? `<div class="warn">${warn.map((w) => `<p>${w}</p>`).join("")}</div>` : ""}
    <h2>result <span class="dim">derived</span></h2>
    ${summary}
    ${built}
    ${joints}
    <h2>contacts <span class="dim">derived</span></h2>
    <div class="scroll"><table class="tbl">
      <tr><th>#</th><th>on</th><th>side</th><th>angle</th><th>kind</th><th>x</th><th>y</th><th>m</th></tr>
      ${rows}
    </table></div>`;
}

// The one-line story of the contact the step slider is parked on.
export function stepInfo(state: State, cs: Contact[], an: Analysis): string {
  if (state.step < 0 || state.step >= cs.length) return `<span class="dim">whole loop</span>`;
  const i = state.step - 1;
  if (i < 0) return `<span class="dim">nothing emitted yet</span>`;
  const inf = an.info[i];
  const prev = i > 0 ? an.info[i - 1] : null;
  const same = prev && prev.owner === inf.owner;
  const P = `P${an.ptOf[inf.owner]}`;
  const what =
    inf.kind === "arc"
      ? `arc step around ${P}`
      : inf.kind === "sample"
        ? `envelope sample, nearest node ${P}`
        : same
          ? `second contact on ${P} — the other side of the joint`
          : inf.kind === "joint"
            ? `joint on ${P} — m ${mag(cs[i])}`
            : `contact on ${P}`;
  return `<b>#${i}</b> ${what} at ${deg(inf.angle)}`;
}
