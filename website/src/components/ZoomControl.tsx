import { useEffect, useRef } from "preact/hooks";
import { useApp } from "../context";
import { useStrokes } from "../strokeStore";

export function ZoomControl() {
  const { view, tool, selected } = useApp();
  const strokes = useStrokes().strokes.value;
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

  const picked = tool === "select" ? selected.filter((i) => i < strokes.length) : [];
  const then = (f: () => void) => () => {
    f();
    menuRef.current?.hidePopover();
  };

  return (
    <>
      <button
        id="btn-zoom"
        ref={buttonRef}
        popovertarget="zoom-menu"
        title="Zoom (Ctrl+scroll); Space+drag to pan"
        aria-label={`Zoom ${Math.round(view.zoom.value * 100)}%`}
      >
        {Math.round(view.zoom.value * 100)}%
      </button>
      <div id="zoom-menu" popover="auto" ref={menuRef}>
        <button
          disabled={picked.length === 0}
          title={picked.length === 0 ? "Select strokes with the loupe first" : undefined}
          onClick={then(() => view.fitStrokes(picked.map((i) => strokes[i])))}
        >
          Zoom to selection
        </button>
        <button disabled={strokes.length === 0} onClick={then(view.fitToView)}>
          Zoom to fit
        </button>
        <button onClick={then(() => view.zoomTo(1))}>Reset zoom</button>
      </div>
    </>
  );
}
