import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { type Tool, useApp } from "../context";
import type { StrokeStyle } from "../stroke";
import { SIZE_RANGE } from "./Brushes";
import { Timeline } from "./Timeline";
import { ToolSettings } from "./ToolSettings";

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

type ArtProps = { color: string; size: number };

// Each tool is drawn from y 0 to 120, with room above for the longest brush tip to reach into:
// iOS Safari clips what overflows an svg in a transformed, filtered button. style.css's lifts
// count the headroom.
const HEADROOM = 6;
const ART_BOX = `0 ${-HEADROOM} 40 ${120 + HEADROOM}`;
const ART_HEIGHT = 120 + HEADROOM;

// a size's place in its range, 0 to 1, on a log scale so the small end still shows
function sizeFraction(style: StrokeStyle, size: number): number {
  const { min, max } = SIZE_RANGE[style];
  return Math.max(0, Math.min(1, Math.log(size / min) / Math.log(max / min)));
}

// The ink at the nib's tip widens with the size, and lengthens less, so a big one is stout,
// and ends round; the metal is 6 wide where it meets it at y 11. A long tip reaches above y 0,
// into the headroom.
function PenArt({ color, size }: ArtProps) {
  const top = 1 + 4 * size;
  const bottom = Math.min(6, top + 1.4);
  const height = 8 + 2 * size;
  const y0 = 11 - height;
  return (
    <svg viewBox={ART_BOX} width="40" height={ART_HEIGHT}>
      <defs>
        <Shade id="pen-metal" dark="#6b6f75" mid="#b9bec4" light="#f2f4f6" />
        <Shade id="pen-grip" dark="#111" mid="#2b2b2e" light="#55565a" />
        <Shade id="pen-body" dark="#0c1a3a" mid="#1e3a78" light="#5d7fc8" />
      </defs>
      <path
        d={`M${20 - bottom / 2} 11L${20 - top / 2} ${y0 + top / 2}A${top / 2} ${top / 2} 0 0 1 ${20 + top / 2} ${y0 + top / 2}L${20 + bottom / 2} 11z`}
        fill={color}
      />
      <path d="M17 11h6l4.5 16h-15z" fill="url(#pen-metal)" />
      <rect x="12" y="27" width="16" height="22" rx="2" fill="url(#pen-grip)" />
      <path d="M12 33h16M12 38h16M12 43h16" stroke="#000" stroke-opacity="0.5" />
      <rect x="12" y="48" width="16" height="72" rx="1" fill="url(#pen-body)" />
      <rect x="15" y="52" width="2" height="64" rx="1" fill="#fff" opacity="0.35" />
    </svg>
  );
}

// With the size the bristles fill out, round off at the tip, and lengthen less, so a big
// brush is stout; the ferrule and handle thicken with them. Long bristles reach above y 0,
// into the headroom.
function BrushArt({ color, size }: ArtProps) {
  // body width, as a scale of the original drawing about its center line x 20
  const body = 0.8 + 0.4 * size;
  const ferrule = 7 * body;
  const handleTop = 6 * body;
  const handleBottom = 7.5 * body;
  const seat = ferrule - 0.5;
  const belly = Math.max(seat, 5 + 5 * size);
  const y0 = 4 - 6 * size;
  const len = 34 - y0;
  // widest a little past halfway down; the tip's roundness, near a point when small
  const yBelly = y0 + 0.62 * len;
  const round = 0.4 + 0.3 * belly * size;
  const hair =
    `M${20 - seat} 34` +
    `C${20 - seat} ${34 - 0.1 * len} ${20 - belly} ${yBelly + 0.15 * len} ${20 - belly} ${yBelly}` +
    `C${20 - belly} ${yBelly - 0.35 * len} ${20 - round} ${y0} 20 ${y0}` +
    `C${20 + round} ${y0} ${20 + belly} ${yBelly - 0.35 * len} ${20 + belly} ${yBelly}` +
    `C${20 + belly} ${yBelly + 0.15 * len} ${20 + seat} ${34 - 0.1 * len} ${20 + seat} 34z`;
  return (
    <svg viewBox={ART_BOX} width="40" height={ART_HEIGHT}>
      <defs>
        <linearGradient id="brush-hair" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color={color} />
          <stop offset="0.3" stop-color={color} />
          <stop offset="0.6" stop-color="#3a2a1c" />
          <stop offset="1" stop-color="#8a6a45" />
        </linearGradient>
        <Shade id="brush-metal" dark="#7a6a4a" mid="#c9b98f" light="#f6eccf" />
        <Shade id="brush-wood" dark="#5a1410" mid="#a3271e" light="#e06a55" />
      </defs>
      <path d={hair} fill="url(#brush-hair)" />
      <rect
        x={20 - ferrule}
        y="33"
        width={2 * ferrule}
        height="22"
        rx="1.5"
        fill="url(#brush-metal)"
      />
      <path
        d={`M${20 - ferrule} 38h${2 * ferrule}M${20 - ferrule} 50h${2 * ferrule}`}
        stroke="#5c4d30"
        stroke-opacity="0.6"
      />
      <path
        d={`M${20 - handleTop} 55h${2 * handleTop}L${20 + handleBottom} 120h${-2 * handleBottom}z`}
        fill="url(#brush-wood)"
      />
      <rect x={20 - handleTop + 2} y="58" width="2" height="58" rx="1" fill="#fff" opacity="0.3" />
    </svg>
  );
}

// The pointing hand cursor on a telescoping stick: the index finger up, the other three
// curled to their knuckles, the thumb out to the left. The palm centers on the stick.
function HandArt() {
  return (
    <svg viewBox={ART_BOX} width="40" height={ART_HEIGHT}>
      <defs>
        <Shade id="hand-chrome" dark="#6b6f75" mid="#b9bec4" light="#f2f4f6" />
        <Shade id="hand-collar" dark="#3c3f44" mid="#80858c" light="#c9cdd2" />
        <Shade id="hand-grip" dark="#141414" mid="#2e2e33" light="#6a6a72" />
      </defs>
      {/* thinner sections slide out of thicker ones, each joint ringed by a collar */}
      <rect x="18.5" y="30" width="3" height="30" fill="url(#hand-chrome)" />
      <rect x="17.75" y="58" width="4.5" height="26" fill="url(#hand-chrome)" />
      <rect x="16.5" y="82" width="7" height="38" rx="2" fill="url(#hand-grip)" />
      <rect x="17.25" y="57" width="5.5" height="3" rx="0.75" fill="url(#hand-collar)" />
      <rect x="16" y="81" width="8" height="3.5" rx="1" fill="url(#hand-collar)" />
      <rect x="18" y="88" width="1.5" height="28" rx="0.75" fill="#fff" opacity="0.25" />
      <g stroke="#111" stroke-linejoin="round" stroke-linecap="round">
        <path
          d="M13 21V4a2.75 2.75 0 0 1 5.5 0v11a2.25 2.25 0 0 1 4.5 0v1a2.25 2.25 0 0 1 4.5 0v1.5a1.75 1.75 0 0 1 3.5 0V29c0 5-3 9-8 9h-5c-3 0-5-1.5-6.5-4L6 27a2.4 2.4 0 0 1 3.6-3.1L13 27.5z"
          fill="#fff"
          stroke-width="1.5"
        />
        <path d="M18.5 15v5M23 16v4.5M27.5 17.5v4" stroke-width="1.2" />
      </g>
    </svg>
  );
}

// three columns of keys, `rows` of them from `top`
function remoteKeys(top: number, rows: number) {
  return Array.from({ length: rows * 3 }, (_, i) => (
    <rect
      key={`${top},${i}`}
      x={11.5 + (i % 3) * 6.25}
      y={top + Math.floor(i / 3) * 6}
      width="4.5"
      height="3.5"
      rx="1.2"
    />
  ));
}

const REMOTE_COLORS = ["#b5484b", "#3f8f5f", "#c9a53e", "#3f6fb0"];

// A media remote standing on end, its buttons unlabeled: power and another at its top, a
// keypad, a row of colors, then a pad of arrows, rockers, and another keypad, which show as
// it's taken up.
function RemoteArt() {
  return (
    <svg viewBox={ART_BOX} width="40" height={ART_HEIGHT}>
      <defs>
        <Shade id="remote-body" dark="#141416" mid="#2a2b30" light="#5a5c66" />
      </defs>
      <rect x="6" y="0" width="28" height="120" rx="6" fill="url(#remote-body)" />
      <rect x="8.5" y="9" width="1.5" height="102" rx="0.75" fill="#fff" opacity="0.15" />
      <circle cx="12.5" cy="5.5" r="2" fill="#c8383d" />
      {REMOTE_COLORS.map((c, i) => (
        <rect key={c} x={10 + i * 5.25} y="30.5" width="4.5" height="2.5" rx="1" fill={c} />
      ))}
      <g fill="#c4c7cd" stroke="#8c9098" stroke-width="0.5">
        <circle cx="27.5" cy="5.5" r="2" />
        {remoteKeys(10.5, 3)}
        <circle cx="20" cy="44.5" r="7.5" />
        <circle cx="20" cy="44.5" r="3.2" />
        <circle cx="12.5" cy="55.5" r="2.2" />
        <circle cx="27.5" cy="55.5" r="2.2" />
        <rect x="11.5" y="60.5" width="5" height="14" rx="2.5" />
        <rect x="23.5" y="60.5" width="5" height="14" rx="2.5" />
        <rect x="18" y="62.5" width="4" height="3" rx="1" />
        <rect x="18" y="68.5" width="4" height="3" rx="1" />
        {remoteKeys(80, 6)}
      </g>
      <path
        d="M20 38v1.5M20 49.5v1.5M13.5 44.5h1.5M25 44.5h1.5"
        stroke="#6e727a"
        stroke-linecap="round"
      />
    </svg>
  );
}

const TOOLS: { id: Tool; title: string; Art: (p: ArtProps) => JSX.Element }[] = [
  { id: "pen", title: "Pen: draws centerlines", Art: PenArt },
  { id: "brush", title: "Brush: draws smooth outlines", Art: BrushArt },
  { id: "select", title: "Select: click or drag to select strokes, shift to add", Art: HandArt },
  { id: "replay", title: "Remote: replay the drawing", Art: RemoteArt },
];

// joined to the tray's right end
function DrawerToggle({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  return (
    <button
      id="drawer-toggle"
      title={open ? "Hide tool settings" : "Tool settings"}
      aria-label={open ? "Hide tool settings" : "Show tool settings"}
      aria-expanded={open}
      aria-controls="drawer"
      onClick={() => setOpen(!open)}
    >
      {/* up to open, turning over to point down to close */}
      <Chevron d="m6 9 6 6 6-6" size={18} />
    </button>
  );
}

// The tools stand in a tray; a press takes one up. Tapped again it opens or closes the drawer
// of its settings beneath, which stays open as tools change, and any tool dragged up or down
// pulls the drawer with it. Replay shows its timeline above.
// px, as style.css lays them out
const TOGGLE_PX = 40;
const TOOL_PX = 40;
const TOOL_GAP = 10;
const PAGER_PX = 40;
// the row around the tools: the drawer toggle, the tray's padding, and the screen's margins
const ROW_PX = TOGGLE_PX + 2 * 18 + 2 * 12;

// as many tools a page as fit the screen; all of them, without page buttons, when they do.
// Paged, the tray spans the screen with a page button flush at each end.
function usePageSize(): number {
  const [width, setWidth] = useState(() => document.documentElement.clientWidth);
  useEffect(() => {
    const resize = () => setWidth(document.documentElement.clientWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const tools = (n: number, gaps: number) => n * TOOL_PX + gaps * TOOL_GAP;
  if (ROW_PX + tools(TOOLS.length, TOOLS.length - 1) <= width) return TOOLS.length;
  let n = TOOLS.length - 1;
  while (n > 1 && TOGGLE_PX + 2 * PAGER_PX + tools(n, n + 1) > width) n--;
  return n;
}

function Chevron({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

// a tool is taken up as it's pressed; moved this far up or down, the press drags the drawer
const DRAG_PX = 6;
// a release moving faster than this, in px/ms, throws the drawer its way
const FLICK = 0.3;

type Press = {
  pointer: number;
  y: number;
  // the tool was already in hand: a tap opens or closes the drawer
  held: boolean;
  dragging: boolean;
  lastY: number;
  lastT: number;
  // upward, px/ms
  speed: number;
};

export function Tools() {
  const { tool, setTool, brushes, closingPress } = useApp();
  const [open, setOpen] = useState(false);
  // how far, in px, a press has dragged the drawer up from where it was
  const [drag, setDrag] = useState<number | null>(null);
  const press = useRef<Press | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  function toolDown(e: PointerEvent, id: Tool) {
    if (e.button !== 0) return;
    const held = tool === id;
    if (!held) setTool(id);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    press.current = {
      pointer: e.pointerId,
      y: e.clientY,
      held,
      dragging: false,
      lastY: e.clientY,
      lastT: e.timeStamp,
      speed: 0,
    };
  }
  function toolMove(e: PointerEvent) {
    const p = press.current;
    if (p === null || p.pointer !== e.pointerId) return;
    const dt = e.timeStamp - p.lastT;
    if (dt > 0) p.speed = (p.lastY - e.clientY) / dt;
    p.lastY = e.clientY;
    p.lastT = e.timeStamp;
    const dy = p.y - e.clientY;
    if (!p.dragging && Math.abs(dy) < DRAG_PX) return;
    p.dragging = true;
    setDrag(dy);
  }
  function toolUp(e: PointerEvent, cancelled: boolean) {
    const p = press.current;
    if (p === null || p.pointer !== e.pointerId) return;
    press.current = null;
    if (p.dragging) {
      const height = innerRef.current?.getBoundingClientRect().height ?? 0;
      const full = contentRef.current?.getBoundingClientRect().height ?? 0;
      // a pause before letting go is no throw
      const thrown = e.timeStamp - p.lastT < 100 && Math.abs(p.speed) > FLICK;
      setOpen(thrown ? p.speed > 0 : height > full / 2);
      // the drawer animates on from where it was let go
      setDrag(null);
    } else if (p.held && !cancelled) setOpen(!open);
  }

  const pageSize = usePageSize();
  const pages = Math.ceil(TOOLS.length / pageSize);
  const paged = pages > 1;
  const toolPage = () => Math.floor(TOOLS.findIndex((t) => t.id === tool) / pageSize);
  const [page, setPage] = useState(toolPage);
  // a new page size starts on the page with the tool in hand
  useEffect(() => setPage(toolPage()), [pageSize]);
  const shownPage = Math.min(page, pages - 1);
  const shownTools = TOOLS.slice(shownPage * pageSize, (shownPage + 1) * pageSize);

  // anywhere but the tray and what hangs off it closes the drawer
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const target = e.target as Element;
      if (target.closest?.("#tray-wrap")) return;
      setOpen(false);
      // the canvas, after this, starts the press as usual but drops it if it's only a tap
      if (target.closest?.("#canvas-svg")) closingPress.current = e.pointerId;
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div id="tray-wrap" class={paged ? "paged" : ""}>
      {tool === "replay" && <Timeline />}
      <div id="base">
        <div id="dock">
          <div id="tray">
            {paged && (
              <button
                class="pager"
                aria-label="Previous tools"
                disabled={shownPage === 0}
                onClick={() => setPage(shownPage - 1)}
              >
                <Chevron d="m15 6-6 6 6 6" />
              </button>
            )}
            {shownTools.map(({ id, title, Art }) => (
              <button
                key={id}
                class={`tool${tool === id ? " on" : ""}`}
                onPointerDown={(e) => toolDown(e, id)}
                onPointerMove={toolMove}
                onPointerUp={(e) => toolUp(e, false)}
                onPointerCancel={(e) => toolUp(e, true)}
                // a press has done its work by now; only the keyboard's click is left
                onClick={(e) => {
                  if (e.detail !== 0) return;
                  if (tool !== id) setTool(id);
                  else setOpen(!open);
                }}
                title={title}
                aria-label={title}
                aria-pressed={tool === id}
              >
                {id === "pen" || id === "brush" ? (
                  <Art color={brushes[id].color} size={sizeFraction(id, brushes[id].size)} />
                ) : (
                  <Art color="" size={0} />
                )}
              </button>
            ))}
            {/* the last page keeps the others' width */}
            {paged &&
              Array.from({ length: pageSize - shownTools.length }, (_, i) => (
                <span key={`empty${i}`} class="tool-slot" />
              ))}
            {paged && (
              <button
                class="pager"
                aria-label="More tools"
                disabled={shownPage === pages - 1}
                onClick={() => setPage(shownPage + 1)}
              >
                <Chevron d="m9 6 6 6-6 6" />
              </button>
            )}
          </div>
          <DrawerToggle open={open} setOpen={setOpen} />
        </div>
        <div
          id="drawer"
          class={`${open ? "open" : ""}${drag !== null ? " dragging" : ""}`}
          inert={!open}
        >
          <div
            class="drawer-inner"
            ref={innerRef}
            // style.css has the drawer's height; a drag only moves it from there, within it
            style={
              drag !== null
                ? {
                    height: `clamp(0px, calc(${open ? "var(--drawer-height) + " : ""}${drag}px), var(--drawer-height))`,
                  }
                : undefined
            }
          >
            <div class="drawer-content" ref={contentRef}>
              <ToolSettings tool={tool} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
