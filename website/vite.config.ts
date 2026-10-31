import preact from "@preact/preset-vite";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

// Dev only: the centerline bench POSTs a stroke here and it lands in
// rescrawl/test/samples/ as JSON, where tests, scripts and Claude can read it.
// The name is made here from the time and the label -- nothing the page sends
// becomes a path.
function saveSamples(): Plugin {
  const dir = fileURLToPath(new URL("../rescrawl/test/samples/", import.meta.url));
  return {
    name: "save-samples",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__samples", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            const ok =
              Array.isArray(data.raw) &&
              data.raw.length > 0 &&
              data.raw.every(
                (p: unknown) =>
                  typeof p === "object" &&
                  p !== null &&
                  ["x", "y", "t"].every((k) => Number.isFinite((p as Record<string, number>)[k])),
              );
            if (!ok) throw new Error("expected { raw: [{ x, y, t }, ...] }");
            const slug = String(data.label ?? "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 40);
            const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            const name = `${stamp}${slug ? `-${slug}` : ""}.json`;
            mkdirSync(dir, { recursive: true });
            // one sample per line: diffable, and greppable by eye
            writeFileSync(dir + name, JSON.stringify(data).replaceAll("},{", "},\n{") + "\n");
            res.end(name);
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact(), saveSamples()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        compare: fileURLToPath(new URL("compare.html", import.meta.url)),
        centerline: fileURLToPath(new URL("centerline.html", import.meta.url)),
      },
    },
  },
});
