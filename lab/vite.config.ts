import { defineConfig } from "vite";

// No framework on purpose: the point of this app is to watch `toOutline` run,
// and a full reload on every edit is the fastest honest way to do that. State
// lives in localStorage so the reload keeps the points you set up.
export default defineConfig({
  server: { port: 5174 },
});
