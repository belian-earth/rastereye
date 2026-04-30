import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { FileServer } from "./fileServer";

export class GeoTIFFEditorProvider
  implements vscode.CustomReadonlyEditorProvider
{
  private static readonly viewType = "rastereye.geotiffViewer";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly fileServer: FileServer
  ) {}

  static register(
    context: vscode.ExtensionContext,
    fileServer: FileServer
  ): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      GeoTIFFEditorProvider.viewType,
      new GeoTIFFEditorProvider(context, fileServer),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  async openCustomDocument(
    uri: vscode.Uri
  ): Promise<vscode.CustomDocument> {
    const fsPath = uri.fsPath;
    return {
      uri,
      dispose: () => this.fileServer.unregisterFile(fsPath),
    };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const serverPort = this.fileServer.getPort();

    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
      ],
      portMapping: [
        { webviewPort: serverPort, extensionHostPort: serverPort },
      ],
    };

    const fileUrl = this.fileServer.registerFile(document.uri.fsPath);
    const filename = path.basename(document.uri.fsPath);

    // Read the viewer HTML template and inject the file URL + script URI
    const viewerHtmlPath = path.join(
      this.context.extensionPath,
      "dist",
      "viewer.html"
    );
    let html = fs.readFileSync(viewerHtmlPath, "utf-8");

    // Replace the relative script src with webview URI
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js")
    );
    html = html.replace(
      `src="./webview.js"`,
      `src="${scriptUri}"`
    );

    // Inject file URL and filename as global variables before the main script
    const injection = `<script>
      window.__RASTEREYE_FILE_URL__ = ${JSON.stringify(fileUrl)};
      window.__RASTEREYE_FILENAME__ = ${JSON.stringify(filename)};
    </script>`;
    html = html.replace("</head>", `${injection}\n</head>`);

    // Adjust CSP for webview context.
    const csp = `<meta http-equiv="Content-Security-Policy" content="
      default-src 'none';
      script-src ${webview.cspSource} https://unpkg.com 'unsafe-inline' 'wasm-unsafe-eval';
      style-src 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com;
      img-src ${webview.cspSource} https: data: blob: http://127.0.0.1:${serverPort};
      connect-src https: http://127.0.0.1:${serverPort};
      worker-src blob: ${webview.cspSource};
      font-src https://fonts.gstatic.com https: data:;
      child-src blob:;
    ">`;
    // Replace any existing CSP or insert after charset
    if (html.includes("Content-Security-Policy")) {
      html = html.replace(
        /<meta[^>]*Content-Security-Policy[^>]*>/,
        csp
      );
    } else {
      html = html.replace(
        '<meta charset="UTF-8">',
        `<meta charset="UTF-8">\n  ${csp}`
      );
    }

    webview.html = html;
  }
}
