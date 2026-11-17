import * as esbuild from "esbuild";
import { copyFileSync, readFileSync } from "fs";

const isWatch = process.argv.includes("--watch");

// Extension host bundle (Node.js / CJS)
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: true,
  minify: !isWatch,
};

// Webview bundle (browser / ESM — needed for top-level await in deps).
// maplibre-gl (JS + CSS) is bundled rather than CDN-loaded so no
// third-party-served code runs in the webview.
// maplibre-gl 6 ships its worker as a separate ES module that it expects to
// fetch at runtime. In a VS Code webview that fetch happens inside a worker,
// where the service worker that serves extension resources does not apply, so
// the map never starts. Inline the worker source as a string instead; main.ts
// starts it from a blob URL.
const maplibreWorkerSource = {
  name: "maplibre-worker-source",
  setup(build) {
    build.onResolve({ filter: /^maplibre-worker-source$/ }, () => ({
      path: "maplibre-worker-source",
      namespace: "maplibre-worker-source",
    }));
    build.onLoad({ filter: /.*/, namespace: "maplibre-worker-source" }, () => ({
      contents: readFileSync(
        "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
        "utf8",
      ),
      loader: "text",
    }));
  },
};

const webviewConfig = {
  plugins: [maplibreWorkerSource],
  entryPoints: ["webview/main.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "dist/webview.js",
  sourcemap: true,
  minify: !isWatch,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  // One shared `lerc` module for both GeoTIFF readers (see the shim). Its ES
  // build imports Node's "module" on a branch that never runs in a browser.
  alias: {
    lerc: "./webview/shims/lerc.js",
  },
  external: ["module"],
  loader: {
    ".png": "binary",
    ".wasm": "binary",
  },
};

if (isWatch) {
  const ctx1 = await esbuild.context(extensionConfig);
  const ctx2 = await esbuild.context(webviewConfig);
  await ctx1.watch();
  await ctx2.watch();
  copyFileSync("webview/viewer.html", "dist/viewer.html");
  console.log("Watching for changes...");
} else {
  await esbuild.build(extensionConfig);
  await esbuild.build(webviewConfig);
  copyFileSync("webview/viewer.html", "dist/viewer.html");
  console.log("Build complete.");
}
