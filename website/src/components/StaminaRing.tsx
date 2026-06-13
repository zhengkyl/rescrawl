import type { RefObject } from 'preact';

export const STAMINA_R = 11;            // ring radius (px)
export const STAMINA_C = 14;            // svg centre (px)
const STAMINA_SIZE = STAMINA_C * 2;

// Remaining-fraction arc starting at the top, drawn clockwise — so as `frac`
// shrinks the trailing edge recedes counterclockwise (Zelda-style depletion).
export function staminaArc(frac: number): string {
  frac = Math.max(0, Math.min(1, frac));
  const cx = STAMINA_C, cy = STAMINA_C, r = STAMINA_R;
  if (frac >= 1) return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`;
  const ang = frac * 2 * Math.PI;
  const x1 = cx + r * Math.sin(ang);
  const y1 = cy - r * Math.cos(ang);
  const largeArc = frac > 0.5 ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`;
}

type Props = {
  containerRef: RefObject<HTMLDivElement>;
  arcRef: RefObject<SVGPathElement>;
};

// Floating countdown ring. Position/opacity/arc are driven imperatively by
// useLiveRecording via the refs — this is just the markup.
export function StaminaRing({ containerRef, arcRef }: Props) {
  return (
    <div id="stamina" ref={containerRef}>
      <svg width={STAMINA_SIZE} height={STAMINA_SIZE} viewBox={`0 0 ${STAMINA_SIZE} ${STAMINA_SIZE}`}>
        <circle cx={STAMINA_C} cy={STAMINA_C} r={STAMINA_R} fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="3" />
        <path ref={arcRef} fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" />
      </svg>
    </div>
  );
}
