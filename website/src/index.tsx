import { render } from "preact";
import { Workspace } from "./components/Workspace";
import { StrokeProvider } from "./strokeStore";
import "./style.css";

// Safari pinch-zooms the page past touch-action; the canvas does its own pinch
document.addEventListener("gesturestart", (e) => e.preventDefault());

render(
  <StrokeProvider>
    <Workspace />
  </StrokeProvider>,
  document.getElementById("app")!,
);
