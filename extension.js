const vscode = require("vscode");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

let lineagePanel; // Reusable panel reference

function activate(context) {
  // 1. The Command to Open/Show Lineage
  const command = vscode.commands.registerCommand("dbtLineage.show", async () => {
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showErrorMessage("Please open a dbt project folder first.");
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      // vscode.window.showErrorMessage("No active file found.");
      return;
    }

    const activeFilePath = editor.document.uri.fsPath;
    
    // Create/Show Panel
    ensurePanel(context, workspaceRoot);

    // Initial Render
    updateLineageGraph(activeFilePath, workspaceRoot, context);
  });

  context.subscriptions.push(command);

  // 2. EVENT LISTENER: Update graph when switching files in Explorer/Tabs
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    // Only update if the panel exists and is actually visible
    if (editor && lineagePanel && lineagePanel.visible) {
      
      const doc = editor.document;
      
      // Ensure it's a file on disk (not an output log or git diff)
      if (doc.uri.scheme === 'file') {
        
        // Find the workspace folder for this specific file
        const wsFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
        const rootPath = wsFolder ? wsFolder.uri.fsPath : (vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : null);

        if (rootPath) {
          updateLineageGraph(doc.uri.fsPath, rootPath, context);
        }
      }
    }
  });
}

// --- CORE HELPER FUNCTIONS ---

function ensurePanel(context, workspaceRoot) {
  if (lineagePanel) {
    lineagePanel.reveal(vscode.ViewColumn.Left);
    return;
  }

  lineagePanel = vscode.window.createWebviewPanel(
    "dbtLineage",
    "DBT Lineage",
    vscode.ViewColumn.Left,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
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

  // Handle Double Click from Webview
  lineagePanel.webview.onDidReceiveMessage((msg) => {
    if (msg?.openFile) {
      const absPath = path.join(workspaceRoot, msg.openFile);
      
      vscode.workspace.openTextDocument(vscode.Uri.file(absPath)).then(doc => {
        vscode.window.showTextDocument(doc);
        // Note: The onDidChangeActiveTextEditor listener above will catch this open event 
        // and trigger the update, but we call it here to be instant.
        updateLineageGraph(absPath, workspaceRoot, context);
      });
    }
  });
}

function updateLineageGraph(filePath, workspaceRoot, context) {
  if (!lineagePanel) return;

  // Basic Validation: Skip non-dbt files silently
  if (!filePath.endsWith(".sql") && !filePath.endsWith(".yml")) {
    return; 
  }

  // Extract Model Name
  const modelName = path.basename(filePath, path.extname(filePath));

  // Check dbt project exists
  if (!fs.existsSync(path.join(workspaceRoot, "dbt_project.yml"))) {
    return;
  }

  const pythonScript = path.join(context.extensionUri.fsPath, "python", "l.py");
  if (!fs.existsSync(pythonScript)) {
    vscode.window.showErrorMessage("l.py not found inside extension.");
    return;
  }

  try {
    const cmd = `python "${pythonScript}" "${modelName}"`;
    
    const result = execSync(cmd, {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });

    const lineageData = JSON.parse(result);

    lineagePanel.title = `Lineage: ${modelName}`;
    lineagePanel.webview.postMessage(lineageData);

  } catch (e) {
    // --- SILENT ERROR HANDLING FOR SOURCES ---
    const output = e.stdout ? e.stdout.toString() : "";
    const stderr = e.stderr ? e.stderr.toString() : "";
    const fullMessage = output + stderr + e.message;

    if (fullMessage.includes("not found") && fullMessage.includes("Model")) {
      // Silent return for sources/seeds
      return; 
    }

    vscode.window.showErrorMessage("Lineage Error: " + (stderr || e.message));
  }
}

// --- TEMPLATE LOADERS ---

function loadWebviewTemplate(extensionUri) {
  const templatePath = path.join(extensionUri.fsPath, "webview.html");
  if (!fs.existsSync(templatePath)) {
    throw new Error("webview.html not found inside extension.");
  }
  return fs.readFileSync(templatePath, "utf-8");
}

function getHtml(webview, extensionUri) {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "vis-network.min.js")
  );
  
  const nonce = getNonce();

  let html = loadWebviewTemplate(extensionUri);
  html = html
    .replace(/\{\{cspSource\}\}/g, webview.cspSource)
    .replace(/\{\{nonce\}\}/g, nonce)
    .replace(/\{\{visNetworkUri\}\}/g, scriptUri.toString());

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