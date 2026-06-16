import { useApp } from '../context';
import { STRATEGY_DEFS } from '../curves';
import type { DebugLayers } from '../curves';

const DEBUG_LAYERS: { key: keyof DebugLayers; label: string }[] = [
  { key: 'centerline', label: 'centerline' },
  { key: 'offsets', label: 'offset points' },
  { key: 'dots', label: 'input dots' },
];

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
            {def.id === 'debug' && state.enabled && (
              <div class="debug-layers">
                {DEBUG_LAYERS.map(({ key, label }) => (
                  <label class="debug-layer" key={key}>
                    <input
                      type="checkbox"
                      checked={debug[key]}
                      onInput={(e) => onDebugChange({ ...debug, [key]: (e.target as HTMLInputElement).checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
