/// Pure HTML assembly for the viewer webview, kept free of vscode imports so
/// it can be unit-tested.

/** JSON-encode a value for embedding in an inline <script>. JSON.stringify
 *  alone is unsafe there: a string containing "</script>" terminates the
 *  script block early. Escaping "<" closes that hole. */
export function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export interface ViewerHtmlOptions {
  scriptUri: string;
  cssUri: string;
  fileUrl: string;
  filename: string;
  cspSource: string;
  serverPort: number;
}

export function buildViewerHtml(
  template: string,
  opts: ViewerHtmlOptions
): string {
  let html = template;

  // Replacement strings are passed via functions throughout: String.replace
  // treats "$" sequences in a replacement string as patterns, so a filename
  // containing "$&" would otherwise corrupt the document.
  html = html.replace(`src="./webview.js"`, () => `src="${opts.scriptUri}"`);
  html = html.replace(`href="./webview.css"`, () => `href="${opts.cssUri}"`);

  const injection = `<script>
      window.__RASTEREYE_FILE_URL__ = ${jsonForInlineScript(opts.fileUrl)};
      window.__RASTEREYE_FILENAME__ = ${jsonForInlineScript(opts.filename)};
    </script>`;
  html = html.replace("</head>", () => `${injection}\n</head>`);

  // connect-src needs data: because geotiff.js's ZSTD decoder (zstddec)
  // initialises its WASM module by fetching a base64 data: URL; without it
  // ZSTD-compressed strip files fail with a bare "Failed to fetch".
  const csp = `<meta http-equiv="Content-Security-Policy" content="
      default-src 'none';
      script-src ${opts.cspSource} 'unsafe-inline' 'wasm-unsafe-eval';
      style-src ${opts.cspSource} 'unsafe-inline' https://fonts.googleapis.com;
      img-src ${opts.cspSource} https: data: blob: http://127.0.0.1:${opts.serverPort};
      connect-src https: data: http://127.0.0.1:${opts.serverPort};
      worker-src blob: ${opts.cspSource};
      font-src https://fonts.gstatic.com https: data:;
      child-src blob:;
    ">`;
  if (html.includes("Content-Security-Policy")) {
    html = html.replace(/<meta[^>]*Content-Security-Policy[^>]*>/, () => csp);
  } else {
    html = html.replace(
      '<meta charset="UTF-8">',
      () => `<meta charset="UTF-8">\n  ${csp}`
    );
  }

  return html;
}
