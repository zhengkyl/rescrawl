import { render } from "preact";
import { Workspace } from "./components/Workspace";
import { StrokeProvider } from "./strokeStore";
import "./style.css";

// Safari pinch-zooms the page past touch-action; the canvas does its own pinch,
// from fingers in <Canvas> and from a Mac trackpad in useCanvasView
document.addEventListener("gesturestart", (e) => e.preventDefault());

// iOS Safari applies :active, which shows a button's press, only once the page listens for touches
document.addEventListener("touchstart", () => {}, { passive: true });

render(
  <StrokeProvider>
    <Workspace />
  </StrokeProvider>,
  document.getElementById("app")!,
);
