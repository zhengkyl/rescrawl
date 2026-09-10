import { useEffect, useRef, useState } from "preact/hooks";
import type { BenchMode, Row, Sample, Stats } from "../bench";
import { benchRuns } from "../bench";
import { useApp } from "../context";
import type { OutlineMode } from "../curves";
import { INK_COLOR, renderInk } from "../curves";
import type { Stroke } from "../utils";
import { deserialize, serialize } from "../utils";
import { drawLine } from "./strokeRender";

// A fixed set of prompts, in a fixed order, so a sample file recorded today is
// comparable with one recorded next month: line N of the file is PROMPTS[N].
// They are chosen to hit the cases that move for different reasons -- a slow
// stroke gives the fit many samples per px, a flick gives it very few, a corner
// forces a run break, and a loop brings the outline back alongside itself.
const PROMPTS: { name: string; hint: string }[] = [
  { name: "slow curve", hint: "a lazy S, drawn deliberately — many samples per px" },
  { name: "fast flick", hint: "one quick swipe — few samples, big gaps" },
  { name: "sharp corner", hint: "an L: straight in, hard turn, straight out" },
  { name: "tight loop", hint: "a small circle back over its own start" },
  { name: "scribble", hint: "fast back-and-forth, several reversals" },
  { name: "dwell + go", hint: "press, hold still a beat, then move off" },
];

const ENGINES: OutlineMode[] = ["fit", "sampled", "greedy", "freehand"];
const FRAME_MS = 1000 / 60;

const PAD_W = 560;
const PAD_H = 200;

function num(n: number, digits = 2): string {
  if (!isFinite(n)) return "—";
  return n.toFixed(digits);
}

// Colour a cell by how it compares with the best value in its column: the
// point of the table is the ranking, not the absolute number.
function rank(v: number, best: number): string {
  if (!(best > 0)) return v > 0 ? "worse" : "best";
  const ratio = v / best;
  if (ratio <= 1.05) return "best";
  if (ratio <= 2) return "ok";
  return "worse";
}

export function BenchDialog() {
  const { inkOptions, setBenchOpen } = useApp();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [samples, setSamples] = useState<(Stroke | null)[]>(() => PROMPTS.map(() => null));
  const [active, setActive] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  // Live recording state for the pad.
  const cancelRef = useRef(false);
  const padRef = useRef<SVGSVGElement>(null);
  const recRef = useRef<Stroke | null>(null);
  const originRef = useRef(0);
  const [live, setLive] = useState<Stroke | null>(null);

  useEffect(() => {
    dialogRef.current!.showModal();
    return () => {
      cancelRef.current = true;
    };
  }, []);

  const onClose = () => setBenchOpen(false);
  const captured = samples.filter((s) => s !== null).length;

  // Through the SVG's own screen matrix, not a manual rect scale: a coalesced
  // event is never dispatched, so it has no `currentTarget` to measure, and the
  // viewBox letterboxes whenever the laid-out box is not exactly PAD_W:PAD_H,
  // which a linear rect mapping would silently skew.
  function padPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = padRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const p = padPoint(e.clientX, e.clientY);
    if (p === null) return;
    padRef.current!.setPointerCapture(e.pointerId);
    originRef.current = e.timeStamp;
    recRef.current = [{ ...p, t: 0 }];
    setLive(recRef.current);
    setRows([]); // the samples changed, so any result on screen is stale
  }

  function onMove(e: PointerEvent) {
    const rec = recRef.current;
    if (rec === null) return;
    // Coalesced events carry every sample the device produced, not just the one
    // per frame the browser would otherwise deliver — the same input the real
    // canvas sees, which is the whole point of measuring against it.
    // Some browsers hand back an empty list rather than the event itself.
    const coalesced = e.getCoalescedEvents?.() ?? [];
    for (const ev of coalesced.length ? coalesced : [e]) {
      const p = padPoint(ev.clientX, ev.clientY);
      if (p !== null) rec.push({ ...p, t: ev.timeStamp - originRef.current });
    }
    setLive([...rec]);
  }

  function onUp() {
    const rec = recRef.current;
    recRef.current = null;
    setLive(null);
    if (rec === null || rec.length < 2) return;
    setSamples((prev) => prev.map((s, i) => (i === active ? rec : s)));
    setActive((i) => (i + 1 < PROMPTS.length ? i + 1 : i));
  }

  function save() {
    const present = samples.filter((s): s is Stroke => s !== null);
    if (present.length === 0) return;
    const blob = new Blob([serialize(samples.map((s) => s ?? [{ x: 0, y: 0, t: 0 }]))], {
      type: "text/plain",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "jitter-samples.scrawl";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function load(file: File) {
    const strokes = deserialize(await file.text());
    // A one-point line is the placeholder `save` writes for a prompt that was
    // never recorded, so it loads back as "still missing" rather than as data.
    setSamples(PROMPTS.map((_, i) => (strokes[i] && strokes[i].length > 1 ? strokes[i] : null)));
    setRows([]);
    setActive(0);
  }

  function run() {
    const present: Sample[] = [];
    samples.forEach((s, i) => {
      if (s !== null) present.push({ name: PROMPTS[i].name, stroke: s });
    });
    if (present.length === 0) return;
    setRunning(true);
    setRows([]);
    const gen = benchRuns(present, ENGINES, inkOptions, FRAME_MS);
    cancelRef.current = false;
    // Pull work until the frame budget is spent, then hand the browser a frame.
    // The generator yields every few rasterizations, so nothing between two
    // yields is long enough to be felt.
    const pump = () => {
      if (cancelRef.current) {
        setRunning(false);
        return;
      }
      const t0 = performance.now();
      const done: Row[] = [];
      for (;;) {
        const next = gen.next();
        if (next.done) {
          if (done.length) setRows((r) => [...r, ...done]);
          setRunning(false);
          return;
        }
        if (next.value) done.push(next.value);
        if (performance.now() - t0 > 10) break;
      }
      if (done.length) setRows((r) => [...r, ...done]);
      requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
  }

  const modes: BenchMode[] = ["draw", "animate"];
  const cell = (r: Row | undefined, pick: (s: Stats) => number) =>
    r ? (detail ? (r.perSample[detail] ? pick(r.perSample[detail]) : NaN) : pick(r.overall)) : NaN;

  const preview = live ?? samples[active];

  return (
    <dialog ref={dialogRef} class="bench-dialog" onClose={onClose}>
      <h3 class="bench-title">Interframe jitter</h3>
      <p class="bench-blurb">
        Renders each sample frame by frame and counts the pixels that changed since the last frame.
        Lower is stiller. The growing tail changes every frame whatever the engine does — that costs
        every engine the same, so the ranking is what to read, not the absolute number.
      </p>

      <div class="bench-cols">
        <div class="bench-capture">
          <div class="bench-prompts">
            {PROMPTS.map((p, i) => (
              <button
                key={p.name}
                type="button"
                class={`bench-prompt${i === active ? " on" : ""}${samples[i] ? " has" : ""}`}
                onClick={() => setActive(i)}
                title={p.hint}
              >
                <span class="bench-dot">{samples[i] ? "●" : "○"}</span>
                {p.name}
              </button>
            ))}
          </div>
          <div class="bench-hint">{PROMPTS[active].hint}</div>
          <svg
            ref={padRef}
            class="bench-pad"
            viewBox={`0 0 ${PAD_W} ${PAD_H}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {preview && preview.length > 1 ? (
              drawLine(renderInk(preview, inkOptions, Infinity), "pad", INK_COLOR)
            ) : (
              <text x={PAD_W / 2} y={PAD_H / 2} text-anchor="middle" class="bench-empty">
                draw “{PROMPTS[active].name}” here
              </text>
            )}
          </svg>
          <div class="bench-actions">
            <button
              type="button"
              onClick={() => setSamples((p) => p.map((s, i) => (i === active ? null : s)))}
            >
              Clear this
            </button>
            <button type="button" onClick={() => fileRef.current!.click()}>
              Load
            </button>
            <button type="button" disabled={captured === 0} onClick={save}>
              Save
            </button>
            <button
              type="button"
              class="primary"
              disabled={captured === 0 || running}
              onClick={run}
            >
              {running ? "Running…" : `Run (${captured}/${PROMPTS.length})`}
            </button>
          </div>
        </div>

        <div class="bench-results">
          <div class="bench-scope">
            <button
              type="button"
              class={`bench-chip${detail === null ? " on" : ""}`}
              onClick={() => setDetail(null)}
            >
              worst of all
            </button>
            {PROMPTS.map((p, i) =>
              samples[i] ? (
                <button
                  key={p.name}
                  type="button"
                  class={`bench-chip${detail === p.name ? " on" : ""}`}
                  onClick={() => setDetail(p.name)}
                >
                  {p.name}
                </button>
              ) : null,
            )}
          </div>
          {rows.length === 0 ? (
            <div class="bench-placeholder">
              {captured === 0
                ? "Draw at least one sample, then Run."
                : running
                  ? "Measuring…"
                  : "Run to compare engines."}
            </div>
          ) : (
            modes.map((mode) => {
              const mrows = ENGINES.map((e) => rows.find((r) => r.engine === e && r.mode === mode));
              const bestOf = (pick: (s: Stats) => number) =>
                Math.min(...mrows.map((r) => cell(r, pick)).filter((v) => isFinite(v)));
              return (
                <div key={mode} class="bench-table-wrap">
                  <h4>
                    {mode === "draw" ? "while drawing" : "while animating"}
                    <span class="bench-sub">
                      {mode === "draw"
                        ? "pen down: samples arriving + dwell tip, per frame"
                        : "playback: stroke clipped at t, per frame"}
                    </span>
                  </h4>
                  <table class="bench-table">
                    <thead>
                      <tr>
                        <th>engine</th>
                        <th>px/frame</th>
                        <th>worst frame</th>
                        <th>% of ink</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ENGINES.map((e, ei) => {
                        const r = mrows[ei];
                        const cols: [(s: Stats) => number, number][] = [
                          [(s) => s.mean, 0],
                          [(s) => s.max, 0],
                          [(s) => s.pct, 1],
                        ];
                        return (
                          <tr key={e}>
                            <td class="bench-engine">{e}</td>
                            {cols.map(([pick, digits], k) => {
                              const v = cell(r, pick);
                              return (
                                <td key={k} class={isFinite(v) ? rank(v, bestOf(pick)) : ""}>
                                  {num(v, digits)}
                                  {isFinite(v) && digits === 1 ? "%" : ""}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".scrawl"
        style="display:none"
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) {
            load(f);
            (e.target as HTMLInputElement).value = "";
          }
        }}
      />
      <div class="dialog-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
