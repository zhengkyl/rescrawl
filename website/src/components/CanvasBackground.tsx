const CANVAS_EXTENT = 100000; // half-size of the "infinite" background
const LINE_SPACING = 40;
const SIZE = 2 * CANVAS_EXTENT;

// The "infinite" white sheet plus optional ruled guidelines, drawn as a single
// tiling pattern so it pans/zooms with the content.
export function CanvasBackground({ guidelines }: { guidelines: boolean }) {
  return (
    <>
      <defs>
        <pattern id="guidelines" width={LINE_SPACING} height={LINE_SPACING} patternUnits="userSpaceOnUse">
          <line x1="0" y1={LINE_SPACING} x2={LINE_SPACING} y2={LINE_SPACING} stroke="#c8d8f0" stroke-width="1" />
        </pattern>
      </defs>
      <rect x={-CANVAS_EXTENT} y={-CANVAS_EXTENT} width={SIZE} height={SIZE} fill="white" />
      {guidelines && (
        <rect x={-CANVAS_EXTENT} y={-CANVAS_EXTENT} width={SIZE} height={SIZE} fill="url(#guidelines)" />
      )}
    </>
  );
}
