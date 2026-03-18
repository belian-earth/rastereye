import * as vscode from "vscode";
import { GeoTIFFEditorProvider } from "./editorProvider";
import { FileServer } from "./fileServer";

let fileServer: FileServer;

export async function activate(context: vscode.ExtensionContext) {
  fileServer = new FileServer(context.extensionPath);
  await fileServer.start();

  context.subscriptions.push(
    GeoTIFFEditorProvider.register(context, fileServer),
    { dispose: () => fileServer.dispose() }
  );
}

export function deactivate() {
  fileServer?.dispose();
}
