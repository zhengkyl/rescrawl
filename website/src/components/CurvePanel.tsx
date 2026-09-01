import { useApp } from '../context';
import { DEBUG_EXTRAS, DEBUG_STAGES, inkStages, STRATEGY_DEFS } from '../curves';
import type { DebugLayers } from '../curves';
import { useStrokes } from '../strokeStore';
import { activeStrokeAt, withinStroke } from '../utils';

// How many points survive each stage, for the stroke under the playhead (or the
// last one drawn). This is the readout that makes the pipeline's order legible:
// the counts only ever go down, and you can see which stage did the dropping.
// Its own component so the per-frame playhead read doesn't re-render the panel.
function StageCounts() {
  const { clock, inkOptions } = useApp();
  const store = useStrokes();
  const strokes = store.strokes.value;
  const t = clock.elapsed.value;
  if (strokes.length === 0) return null;

  const i = activeStrokeAt(strokes, t) ?? strokes.length - 1;
  const stroke = strokes[i];
  const { outline, stages } = inkStages(stroke, inkOptions, withinStroke(stroke, t) ? t : Infinity);

  return (
    <div class="stage-counts">
      {DEBUG_STAGES.map(({ key, label, color }) => (
        <div class="stage-count" key={key}>
          <span class="stage-dot" style={`background:${color}`} />
          <span class="stage-name">{label}</span>
          <span class="stage-n">{stages[key].length}</span>
        </div>
      ))}
      <div class="stage-count">
        <span class="stage-dot" style="background:#ef4444" />
        <span class="stage-name">4 · outline pts</span>
        <span class="stage-n">{outline.length}</span>
      </div>
    </div>
  );
}

function LayerToggle({ k, label, color, debug, onChange }: {
  k: keyof DebugLayers;
  label: string;
  color: string;
  debug: DebugLayers;
  onChange: (next: DebugLayers) => void;
}) {
  return (
    <label class="debug-layer">
      <input
        type="checkbox"
        checked={debug[k]}
        onInput={(e) => onChange({ ...debug, [k]: (e.target as HTMLInputElement).checked })}
      />
      <span class="stage-dot" style={`background:${color}`} />
      {label}
    </label>
  );
}

export function CurvePanel() {
  const { strategies, setStrategies: onChange, debug, setDebug: onDebugChange } = useApp();

  function toggle(id: string) {
    const cur = strategies[id];
    onChange({ ...strategies, [id]: { ...cur, enabled: !cur.enabled } });
  }

  function setParam(id: string, value: number) {
    const cur = strategies[id];
    onChange({ ...strategies, [id]: { ...cur, param: value } });
  }

  return (
    <>
      <div class="section-label">Curve Rendering</div>
      {STRATEGY_DEFS.map(def => {
        const state = strategies[def.id] ?? { enabled: false, param: def.defaultParam };
        return (
          <div key={def.id}>
            <div class="strategy-row">
              <button
                class="strategy-toggle"
                style={state.enabled ? `background:${def.color};color:#fff` : ''}
                onClick={() => toggle(def.id)}
                title={def.id}
              >
                {def.label}
              </button>
              {def.paramLabel && (
                <input
                  type="number"
                  class="strategy-param"
                  value={state.param}
                  min={def.paramMin}
                  max={def.paramMax}
                  step={def.paramStep}
                  disabled={!state.enabled}
                  title={def.paramLabel}
                  onInput={(e) => setParam(def.id, +(e.target as HTMLInputElement).value)}
                />
              )}
            </div>
            {/* Pipeline stages first, in the order they run, then the derived
                geometry. Same order as the counts below them. */}
            {def.id === 'debug' && state.enabled && (
              <div class="debug-layers">
                {DEBUG_STAGES.map(({ key, label, color }) => (
                  <LayerToggle key={key} k={key} label={label} color={color}
                    debug={debug} onChange={onDebugChange} />
                ))}
                <div class="debug-sep" />
                {DEBUG_EXTRAS.map(({ key, label, color }) => (
                  <LayerToggle key={key} k={key} label={label} color={color}
                    debug={debug} onChange={onDebugChange} />
                ))}
                <StageCounts />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
