// what marks the pen and the brush over the canvas: the hardware crosshair, the brush's
// outline, or both
export type CursorStyle = "crosshair" | "both" | "circle";

// paper under the ink; `spacing`: between the middle layer's dots or lines, in drawing px
export type Texture = "none" | "dots" | "lines";

export type Prefs = { cursor: CursorStyle; texture: Texture; spacing: number };
export const PREFS_DEFAULTS: Prefs = { cursor: "crosshair", texture: "none", spacing: 48 };
export const PREFS_STORAGE_KEY = "rescrawl-prefs-1";
