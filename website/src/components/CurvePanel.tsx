import { STRATEGY_DEFS } from '../curves';
import type { StrategiesState } from '../curves';

type Props = {
  strategies: StrategiesState;
  onChange: (s: StrategiesState) => void;
};

export function CurvePanel({ strategies, onChange }: Props) {
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
          <div class="strategy-row" key={def.id}>
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
        );
      })}
    </>
  );
}
