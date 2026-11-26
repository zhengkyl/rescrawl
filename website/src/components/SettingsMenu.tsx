import { useEffect, useRef } from "preact/hooks";
import { useApp } from "../context";
import type { CursorStyle, Prefs, Texture } from "../prefs";
import { FADE_TO_PX, TEXTURE_STEP } from "./Canvas";
import { Slider } from "./Knobs";

// each drawn as it shows over the canvas: a thin plus, and Canvas.tsx's faint ring
function CursorArt({ crosshair, circle }: { crosshair: boolean; circle: boolean }) {
  return (
    <svg aria-hidden="true" width="48" height="48" viewBox="0 0 48 48">
      {circle && (
        <g opacity="0.35" fill="none">
          <circle cx="24.5" cy="24.5" r="13" stroke="#fff" stroke-width="2" />
          <circle cx="24.5" cy="24.5" r="13" stroke="#1a1a1a" stroke-width="1" />
        </g>
      )}
      {crosshair && <path d="M24.5 15v19M15 24.5h19" stroke="#1a1a1a" stroke-width="1" />}
    </svg>
  );
}

// a patch of the paper, at a spacing that shows a few rows
function TextureArt({ texture }: { texture: Texture }) {
  return (
    <svg aria-hidden="true" width="48" height="48" viewBox="0 0 48 48">
      {texture === "dots" &&
        [6, 18, 30, 42].flatMap((y) =>
          [6, 18, 30, 42].map((x) => (
            <circle key={`${x},${y}`} cx={x} cy={y} r="1" fill="#cfcfcf" />
          )),
        )}
      {texture === "lines" && <path d="M0 6.5h48M0 18.5h48M0 30.5h48M0 42.5h48" stroke="#e8e8e8" />}
    </svg>
  );
}

const TEXTURES: { value: Texture; label: string }[] = [
  { value: "none", label: "Blank" },
  { value: "dots", label: "Dots" },
  { value: "lines", label: "Lines" },
];

const CURSORS: { value: CursorStyle; label: string; crosshair: boolean; circle: boolean }[] = [
  { value: "crosshair", label: "Crosshair", crosshair: true, circle: false },
  { value: "circle", label: "Outline", crosshair: false, circle: true },
  { value: "both", label: "Both", crosshair: true, circle: true },
];

export function SettingsMenu() {
  const { prefs } = useApp();
  const set = (patch: Partial<Prefs>) => (prefs.value = { ...prefs.value, ...patch });
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // the menu opens in the top layer, out of the page's layout: put it under the button
  useEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    const place = (e: Event) => {
      const button = buttonRef.current;
      if ((e as ToggleEvent).newState !== "open" || button === null) return;
      const r = button.getBoundingClientRect();
      menu.style.left = `${r.left}px`;
      menu.style.top = `${r.bottom + 6}px`;
    };
    menu.addEventListener("beforetoggle", place);
    return () => menu.removeEventListener("beforetoggle", place);
  }, []);

  return (
    <>
      <button
        id="btn-settings"
        ref={buttonRef}
        popovertarget="settings-menu"
        title="Settings"
        aria-label="Settings"
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div id="settings-menu" popover="auto" ref={menuRef}>
        <section>
          <h2 id="cursor-heading">Cursor</h2>
          <div class="previews" role="radiogroup" aria-labelledby="cursor-heading">
            {CURSORS.map((c) => {
              const on = prefs.value.cursor === c.value;
              return (
                <button
                  key={c.value}
                  class={`preview${on ? " on" : ""}`}
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ cursor: c.value })}
                >
                  <CursorArt crosshair={c.crosshair} circle={c.circle} />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
        </section>
        <section>
          <h2 id="texture-heading">Canvas</h2>
          <div class="previews" role="radiogroup" aria-labelledby="texture-heading">
            {TEXTURES.map((t) => {
              const on = prefs.value.texture === t.value;
              return (
                <button
                  key={t.value}
                  class={`preview${on ? " on" : ""}`}
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ texture: t.value })}
                >
                  <TextureArt texture={t.value} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
          {prefs.value.texture !== "none" && (
            <Slider
              label="spacing (drawing px)"
              // At 100%, the middle layer fully shown, up to the finest layer fully shown too;
              // past that the paper only grows
              min={FADE_TO_PX}
              max={FADE_TO_PX * TEXTURE_STEP}
              step={1}
              value={prefs.value.spacing}
              onInput={(v) => set({ spacing: v })}
            />
          )}
        </section>
      </div>
    </>
  );
}
