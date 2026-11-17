import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { FileServer } from "./fileServer";
import { buildViewerHtml } from "./webviewHtml";

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
    // The viewer reads the file from disk through the local file server.
    // For any other scheme (a git revision, a remote or virtual file system)
    // fsPath would point at a different file, or at nothing.
    if (uri.scheme !== "file") {
      throw new Error(
        `RasterEye can only open local files (got a "${uri.scheme}:" resource).`
      );
    }
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

    // Read the viewer HTML template and inject the file URL + asset URIs
    const viewerHtmlPath = path.join(
      this.context.extensionPath,
      "dist",
      "viewer.html"
    );
    const template = fs.readFileSync(viewerHtmlPath, "utf-8");

    const assetUri = (name: string) =>
      webview
        .asWebviewUri(
          vscode.Uri.joinPath(this.context.extensionUri, "dist", name)
        )
        .toString();

    webview.html = buildViewerHtml(template, {
      scriptUri: assetUri("webview.js"),
      cssUri: assetUri("webview.css"),
      fileUrl,
      filename,
      cspSource: webview.cspSource,
      serverPort,
      nonce: crypto.randomBytes(16).toString("base64"),
    });
  }
}
