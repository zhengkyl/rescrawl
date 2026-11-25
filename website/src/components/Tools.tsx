import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { type Tool, useApp } from "../context";
import { StrokeInk } from "../ink";
import type { StrokeStyle } from "../stroke";
import { useStrokes } from "../strokeStore";

// cylinder shading, lit from the left
function Shade({ id, dark, mid, light }: { id: string; dark: string; mid: string; light: string }) {
  return (
    <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color={dark} />
      <stop offset="0.3" stop-color={light} />
      <stop offset="0.55" stop-color={mid} />
      <stop offset="1" stop-color={dark} />
    </linearGradient>
  );
}

function PenArt() {
  return (
    <svg viewBox="0 0 40 120" width="40" height="120">
      <defs>
        <Shade id="pen-metal" dark="#6b6f75" mid="#b9bec4" light="#f2f4f6" />
        <Shade id="pen-grip" dark="#111" mid="#2b2b2e" light="#55565a" />
        <Shade id="pen-body" dark="#0c1a3a" mid="#1e3a78" light="#5d7fc8" />
      </defs>
      <path d="M19.2 1h1.6l.7 10h-3z" fill="#111" />
      <path d="M17 11h6l4.5 16h-15z" fill="url(#pen-metal)" />
      <rect x="12" y="27" width="16" height="22" rx="2" fill="url(#pen-grip)" />
      <path d="M12 33h16M12 38h16M12 43h16" stroke="#000" stroke-opacity="0.5" />
      <rect x="12" y="48" width="16" height="72" rx="1" fill="url(#pen-body)" />
      <rect x="15" y="52" width="2" height="64" rx="1" fill="#fff" opacity="0.35" />
    </svg>
  );
}

function BrushArt() {
  return (
    <svg viewBox="0 0 40 120" width="40" height="120">
      <defs>
        <linearGradient id="brush-hair" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#111" />
          <stop offset="0.45" stop-color="#3a2a1c" />
          <stop offset="1" stop-color="#8a6a45" />
        </linearGradient>
        <Shade id="brush-metal" dark="#7a6a4a" mid="#c9b98f" light="#f6eccf" />
        <Shade id="brush-wood" dark="#5a1410" mid="#a3271e" light="#e06a55" />
      </defs>
      <path d="M20 1c4 9 7 19 6.5 33h-13C13 20 16 10 20 1z" fill="url(#brush-hair)" />
      <rect x="13" y="33" width="14" height="22" rx="1.5" fill="url(#brush-metal)" />
      <path d="M13 38h14M13 50h14" stroke="#5c4d30" stroke-opacity="0.6" />
      <path d="M14 55h12l1.5 65h-15z" fill="url(#brush-wood)" />
      <rect x="16" y="58" width="2" height="58" rx="1" fill="#fff" opacity="0.3" />
    </svg>
  );
}

function LoupeArt() {
  return (
    <svg viewBox="0 0 40 120" width="40" height="120">
      <defs>
        <radialGradient id="loupe-glass" cx="0.35" cy="0.35" r="0.8">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.9" />
          <stop offset="0.4" stop-color="#cfe6f7" stop-opacity="0.6" />
          <stop offset="1" stop-color="#7fa9c9" stop-opacity="0.7" />
        </radialGradient>
        <Shade id="loupe-metal" dark="#6e5a2a" mid="#c8a64e" light="#f5e2a0" />
        <Shade id="loupe-handle" dark="#141414" mid="#2e2620" light="#6a5a4c" />
      </defs>
      <circle cx="20" cy="19" r="15" fill="url(#loupe-glass)" />
      <circle cx="20" cy="19" r="15" fill="none" stroke="url(#loupe-metal)" stroke-width="4" />
      <path
        d="M11 14a10 10 0 0 1 7-6"
        stroke="#fff"
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
        opacity="0.8"
      />
      <rect x="17.5" y="34" width="5" height="12" fill="url(#loupe-metal)" />
      <rect x="14" y="46" width="12" height="74" rx="5" fill="url(#loupe-handle)" />
      <rect x="16" y="50" width="2" height="64" rx="1" fill="#fff" opacity="0.25" />
    </svg>
  );
}

const TOOLS: { id: Tool; title: string; Art: () => JSX.Element }[] = [
  { id: "pen", title: "Pen: draws centerlines", Art: PenArt },
  { id: "brush", title: "Brush: draws smooth outlines", Art: BrushArt },
  { id: "select", title: "Loupe: pick a stroke to inspect its curve", Art: LoupeArt },
];

const STYLES: { id: StrokeStyle; label: string }[] = [
  { id: "pen", label: "Pen" },
  { id: "brush", label: "Brush" },
];

function Selection({ index }: { index: number }) {
  const { inkOptions } = useApp();
  const store = useStrokes();
  const stroke = store.strokes.value[index];
  const nodes = useMemo(() => {
    const ink = new StrokeInk(stroke, inkOptions);
    ink.whole();
    return ink.fit.nodes;
  }, [stroke, inkOptions]);
  const corners = nodes.filter((n) => n.corner).length;
  return (
    <div id="selection">
      <span>drawn as</span>
      {STYLES.map((s) => (
        <button
          key={s.id}
          class={stroke.style === s.id ? "on" : ""}
          onClick={() => stroke.style !== s.id && store.set(index, { ...stroke, style: s.id })}
        >
          {s.label}
        </button>
      ))}
      <span>
        {stroke.points.length} points · {nodes.length} nodes · {corners} corners
      </span>
    </div>
  );
}

// the tools stand in a tray; the one in hand is lifted out
export function Tools() {
  const { tool, setTool, selected } = useApp();
  const strokes = useStrokes().strokes.value;
  const picked = tool === "select" && selected !== null && selected < strokes.length;
  return (
    <div id="tray">
      {TOOLS.map(({ id, title, Art }) => (
        <button
          key={id}
          class={`tool${tool === id ? " on" : ""}`}
          onClick={() => setTool(id)}
          title={title}
          aria-label={title}
          aria-pressed={tool === id}
        >
          <Art />
        </button>
      ))}
      {picked && <Selection index={selected} />}
    </div>
  );
}
