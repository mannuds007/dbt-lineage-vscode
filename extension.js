const vscode = require("vscode");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

let lineagePanel; // reusable panel reference

function activate(context) {
  const command = vscode.commands.registerCommand("dbtLineage.show", async () => {
    // Ensure workspace
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showErrorMessage("Please open a dbt project folder first.");
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

    // Get active editor model
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No active file found.");
      return;
    }

    const activeFilePath = editor.document.uri.fsPath;
    if (!activeFilePath.endsWith(".sql") && !activeFilePath.endsWith(".yml")) {
      vscode.window.showErrorMessage("Active file is not a dbt model.");
      return;
    }

    const model = path.basename(activeFilePath, path.extname(activeFilePath));

    // Validate dbt project
    if (!fs.existsSync(path.join(workspaceRoot, "dbt_project.yml"))) {
      vscode.window.showErrorMessage("Not a dbt project.");
      return;
    }

    // Resolve Python script
    const pythonScript = path.join(context.extensionUri.fsPath, "python", "l.py");
    if (!fs.existsSync(pythonScript)) {
      vscode.window.showErrorMessage("l.py not found inside extension.");
      return;
    }

    // Run Python
    let lineageData;
    try {
      const result = execSync(`python "${pythonScript}" ${model}`, {
        cwd: workspaceRoot,
        encoding: "utf-8",
      });
      lineageData = JSON.parse(result);
    } catch (e) {
      vscode.window.showErrorMessage(
        e.stderr?.toString() || e.message || "Failed to generate lineage."
      );
      return;
    }

    // Create or reuse panel
    if (!lineagePanel) {
      lineagePanel = vscode.window.createWebviewPanel(
        "dbtLineage",
        `Lineage: ${model}`,
        vscode.ViewColumn.Left,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      try {
        lineagePanel.webview.html = getHtml(lineagePanel.webview, context.extensionUri);
      } catch (e) {
        vscode.window.showErrorMessage(e.message || "Failed to load webview.html");
        lineagePanel.dispose();
        lineagePanel = undefined;
        return;
      }

      lineagePanel.onDidDispose(() => {
        lineagePanel = undefined;
      });

      lineagePanel.webview.onDidReceiveMessage((msg) => {
        if (msg?.openFile) {
          const absPath = path.join(workspaceRoot, msg.openFile);
          vscode.window.showTextDocument(vscode.Uri.file(absPath));
        }
      });
    } else {
      lineagePanel.title = `Lineage: ${model}`;
      lineagePanel.reveal(vscode.ViewColumn.Left);
    }

    // Send only data (optimized reuse)
    lineagePanel.webview.postMessage(lineageData);
  });

  context.subscriptions.push(command);
}

function loadWebviewTemplate(extensionUri) {
  const templatePath = path.join(extensionUri.fsPath, "webview.html");
  if (!fs.existsSync(templatePath)) {
    throw new Error("webview.html not found inside extension.");
  }
  return fs.readFileSync(templatePath, "utf-8");
}

function getHtml(webview, extensionUri) {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "cytoscape.min.js")
  );
  const nonce = getNonce();

  let html = loadWebviewTemplate(extensionUri);
  html = html
    .replace(/\{\{cspSource\}\}/g, webview.cspSource)
    .replace(/\{\{nonce\}\}/g, nonce)
    .replace(/\{\{cytoscapeUri\}\}/g, scriptUri.toString());

  return html;
}

function getNonce() {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

exports.activate = activate;
