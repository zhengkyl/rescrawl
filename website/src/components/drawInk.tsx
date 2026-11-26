import type { Drawn } from "../ink";

// nonzero: the inner side of a turn folds back over itself and must fill solid
export function drawInk({ paths, paint, color }: Drawn, key: string | number) {
  return paths.map((d, j) =>
    paint === "fill" ? (
      <path key={`${key}-${j}`} d={d} fill={color} fill-rule="nonzero" />
    ) : (
      <path
        key={`${key}-${j}`}
        d={d}
        stroke={color}
        stroke-width={paint.width}
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    ),
  );
}
