import * as vscode from "vscode";
import * as path from "path";
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
        webviewOptions: { retainContextWhenHidden: false },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  async openCustomDocument(
    uri: vscode.Uri
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const filename = path.basename(document.uri.fsPath);
    const viewerUrl = this.fileServer.getViewerUrl(document.uri.fsPath);

    // Open in default browser
    await vscode.env.openExternal(vscode.Uri.parse(viewerUrl));

    // Show a placeholder in the editor tab
    const webview = webviewPanel.webview;
    webview.options = { enableScripts: false };
    webview.html = /* html */ `<!DOCTYPE html>
<html><head><style>
  body {
    display: flex; align-items: center; justify-content: center;
    height: 100vh; margin: 0;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 14px;
    color: var(--vscode-foreground, #ccc);
    background: var(--vscode-editor-background, #1e1e1e);
  }
  a { color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; }
</style></head>
<body>
  <div style="text-align:center">
    <p><strong>${filename}</strong> opened in browser.</p>
    <p style="margin-top:8px;opacity:0.7">
      <a href="${viewerUrl}" target="_blank">Reopen in browser</a>
    </p>
  </div>
</body></html>`;
  }
}
