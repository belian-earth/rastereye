import * as esbuild from "esbuild";
import { copyFileSync } from "fs";

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
// maplibre-gl (JS + CSS) is bundled rather than CDN-loaded so the viewer
// works offline and no third-party-served code runs in the webview.
const webviewConfig = {
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
  alias: {
    lerc: "./webview/shims/empty.js",
  },
  loader: {
    ".png": "binary",
  },
};

if (isWatch) {
  const ctx1 = await esbuild.context(extensionConfig);
  const ctx2 = await esbuild.context(webviewConfig);
  await ctx1.watch();
  await ctx2.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(extensionConfig);
  await esbuild.build(webviewConfig);
  copyFileSync("webview/viewer.html", "dist/viewer.html");
  console.log("Build complete.");
}
