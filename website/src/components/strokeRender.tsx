import type { RenderedLine } from '../curves';

// One renderer's output for one stroke, as SVG primitives: fill the shapes if
// present (variable width), otherwise stroke the centreline curve. Shared by the
// drawing surface and the export preview.
export function drawLine(line: RenderedLine, key: string | number, color: string) {
  // fill-rule is load bearing, not decoration: on the inner side of a turn the
  // outline folds back over itself, and that fold fills solid under nonzero and
  // punches a notch out of the corner under even-odd.
  if (line.shapes && line.shapes.length) {
    return line.shapes.map((d, j) => (
      <path key={`${key}-${j}`} d={d} fill={color} fill-rule="nonzero" />
    ));
  }
  return (
    <path key={key} d={line.curve} stroke={color} stroke-width={line.width}
      fill="none" stroke-linecap="round" stroke-linejoin="round" />
  );
}
