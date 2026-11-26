import { useMemo } from "preact/hooks";
import { useApp } from "../context";
import { StrokeInk } from "../ink";
import type { Stroke, StrokeStyle } from "../stroke";
import { strokeEnd, strokeStart } from "../stroke";
import { useStrokes } from "../strokeStore";

const STYLES: { id: StrokeStyle; label: string }[] = [
  { id: "pen", label: "Pen" },
  { id: "brush", label: "Brush" },
];

type Info = { nodes: number; corners: number };

// what every stroke in a list has, or undefined where they differ
function common<T>(strokes: Stroke[], f: (s: Stroke) => T): T | undefined {
  const v = f(strokes[0]);
  return strokes.every((s) => f(s) === v) ? v : undefined;
}

function Styles({ strokes, onPick }: { strokes: Stroke[]; onPick: (s: StrokeStyle) => void }) {
  return (
    <span class="styles">
      {STYLES.map(({ id, label }) => {
        const n = strokes.filter((s) => s.style === id).length;
        const on = n === strokes.length ? " on" : n > 0 ? " some" : "";
        return (
          <button
            key={id}
            class={on}
            aria-pressed={n === strokes.length ? true : n > 0 ? "mixed" : false}
            onClick={() => onPick(id)}
          >
            {label}
          </button>
        );
      })}
    </span>
  );
}

const ms = (s: Stroke) => Math.round(strokeEnd(s) - strokeStart(s));

export function Selection() {
  const { tool, selected, setSelected, inkOptions } = useApp();
  const store = useStrokes();
  const all = store.strokes.value;
  const fits = useMemo(() => new WeakMap<Stroke, Info>(), [inkOptions]);

  if (tool !== "select") return null;
  const picked = selected.filter((i) => i < all.length);
  if (picked.length === 0) return null;
  const strokes = picked.map((i) => all[i]);
  const infos = strokes.map((s) => {
    let info = fits.get(s);
    if (info === undefined) {
      const ink = new StrokeInk(s, inkOptions);
      ink.whole();
      const nodes = ink.fit.nodes;
      info = { nodes: nodes.length, corners: nodes.filter((n) => n.corner).length };
      fits.set(s, info);
    }
    return info;
  });
  const sum = (f: (k: number) => number) => strokes.reduce((a, _, k) => a + f(k), 0);

  function change(indices: number[], patch: Partial<Stroke>) {
    const changing = indices.filter((i) =>
      Object.entries(patch).some(([k, v]) => all[i][k as keyof Stroke] !== v),
    );
    if (changing.length === 0) return;
    store.set(
      changing,
      changing.map((i) => ({ ...all[i], ...patch })),
    );
  }
  const color = common(strokes, (s) => s.color);
  const size = common(strokes, (s) => s.size);

  return (
    <div id="selection">
      <table>
        <thead>
          <tr class="overview">
            <th>{strokes.length === 1 ? "1 stroke" : `${strokes.length} strokes`}</th>
            <th>
              <Styles strokes={strokes} onPick={(style) => change(picked, { style })} />
            </th>
            <th>
              <input
                class="size-input"
                type="number"
                min="0.5"
                max="60"
                step="0.5"
                value={size ?? ""}
                placeholder="mixed"
                inputMode="decimal"
                title="Size of every selected stroke"
                aria-label="Size of every selected stroke"
                onChange={(e) => {
                  const v = +(e.target as HTMLInputElement).value;
                  if (v > 0) change(picked, { size: v });
                }}
              />
            </th>
            <th>
              <label
                class={`swatch${color === undefined ? " mixed" : ""}`}
                style={{ background: color ?? strokes[0].color }}
                title="Color of every selected stroke"
              >
                <input
                  type="color"
                  aria-label="Color of every selected stroke"
                  value={color ?? strokes[0].color}
                  onChange={(e) => change(picked, { color: (e.target as HTMLInputElement).value })}
                />
              </label>
            </th>
            <th>{sum((k) => strokes[k].points.length)}</th>
            <th>{sum((k) => infos[k].nodes)}</th>
            <th>{sum((k) => infos[k].corners)}</th>
            <th>{sum((k) => ms(strokes[k]))}</th>
          </tr>
          <tr class="labels">
            <th />
            <th />
            <th>size</th>
            <th />
            <th>points</th>
            <th>nodes</th>
            <th>corners</th>
            <th>ms</th>
          </tr>
        </thead>
        <tbody>
          {picked.map((i, k) => (
            <tr key={i}>
              <td>
                <button class="index" title="Select only this" onClick={() => setSelected([i])}>
                  #{i + 1}
                  {strokes[k].points.some((p) => p.p !== undefined) && (
                    <span title="pen pressure"> p</span>
                  )}
                </button>
              </td>
              <td>
                <Styles strokes={[strokes[k]]} onPick={(style) => change([i], { style })} />
              </td>
              <td>{strokes[k].size}</td>
              <td>
                <span class="swatch small" style={{ background: strokes[k].color }} />
              </td>
              <td>{strokes[k].points.length}</td>
              <td>{infos[k].nodes}</td>
              <td>{infos[k].corners}</td>
              <td>{ms(strokes[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
