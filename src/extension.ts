import * as vscode from "vscode";
import { GeoTIFFEditorProvider } from "./editorProvider";
import { FileServer } from "./fileServer";

let fileServer: FileServer;

export async function activate(context: vscode.ExtensionContext) {
  fileServer = new FileServer(context.extensionPath);
  await fileServer.start();

  const openCommand = vscode.commands.registerCommand(
    "rastereye.open",
    (uri: vscode.Uri) =>
      vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        "rastereye.geotiffViewer",
      ),
  );

  context.subscriptions.push(
    GeoTIFFEditorProvider.register(context, fileServer),
    openCommand,
    { dispose: () => fileServer.dispose() }
  );
}

export function deactivate() {
  // FileServer is disposed via context.subscriptions
}
