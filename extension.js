const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

let lineagePanel; // Reusable panel reference

function activate(context) {
  // 1. Command: Show Lineage
  const command = vscode.commands.registerCommand("dbtLineage.show", async () => {
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showErrorMessage("Please open a dbt project folder first.");
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage("No active file found.");
      return;
    }

    ensurePanel(context, workspaceRoot);
    updateLineageGraph(editor.document.uri.fsPath, workspaceRoot, context);
  });

  context.subscriptions.push(command);

  // 2. Event: Switch File (Auto-Update)
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && lineagePanel && lineagePanel.visible) {
      const doc = editor.document;
      if (doc.uri.scheme === 'file') {
        const wsFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
        const rootPath = wsFolder ? wsFolder.uri.fsPath : vscode.workspace.workspaceFolders?.[0].uri.fsPath;

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
    vscode.window.showErrorMessage("Failed to load webview: " + e.message);
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
      vscode.workspace.openTextDocument(vscode.Uri.file(absPath)).then(doc => {
        vscode.window.showTextDocument(doc);
        updateLineageGraph(absPath, workspaceRoot, context);
      });
    }
  });
}

function updateLineageGraph(filePath, workspaceRoot, context) {
  if (!lineagePanel) return;

  // 1. Validation
  if (!filePath.endsWith(".sql") && !filePath.endsWith(".yml")) return;

  const modelName = path.basename(filePath, path.extname(filePath));
  
  if (!fs.existsSync(path.join(workspaceRoot, "dbt_project.yml"))) return;

  // 2. Pure JS Lineage Generation (No Python)
  try {
    const lineageData = generateLineage(workspaceRoot, modelName);
    
    if (!lineageData) {
        // Silent return if model not found (likely a source or seed)
        return; 
    }

    lineagePanel.title = `Lineage: ${modelName}`;
    lineagePanel.webview.postMessage(lineageData);

  } catch (e) {
    // Show error only if it's a system error (e.g. missing manifest), not a logic error
    if (e.message.includes("manifest.json")) {
        vscode.window.showErrorMessage(e.message);
    } else {
        console.error("Lineage extraction failed:", e);
    }
  }
}

// --- NATIVE JS LOGIC (Replaces l.py) ---
function generateLineage(projectRoot, modelName) {
  const manifestPath = path.join(projectRoot, "target", "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    throw new Error("target/manifest.json not found. Run 'dbt compile' or 'dbt build' first.");
  }

  // Read and Parse JSON
  const manifestStr = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestStr);

  const nodes = manifest.nodes || {};
  const sources = manifest.sources || {};

  // 1. Find Current Node
  let currentNodeId = null;
  let currentNode = null;

  // Search in 'nodes' (models, seeds, tests)
  for (const [key, node] of Object.entries(nodes)) {
    if (node.resource_type === 'model' && node.name === modelName) {
      currentNodeId = key;
      currentNode = node;
      break;
    }
  }

  if (!currentNode) {
    // If not found in models, we stop (Sources/Seeds don't have standard upstream lineage)
    return null;
  }

  // 2. Upstream Dependencies
  const upstream = [];
  const parentIds = (currentNode.depends_on && currentNode.depends_on.nodes) ? currentNode.depends_on.nodes : [];

  parentIds.forEach(parentId => {
    // Check if it's a node (Model/Seed)
    if (nodes[parentId]) {
      const p = nodes[parentId];
      if (['model', 'seed'].includes(p.resource_type)) {
        upstream.push({
          name: p.name,
          path: p.original_file_path
        });
      }
    } 
    // Check if it's a Source
    else if (sources[parentId]) {
      const s = sources[parentId];
      upstream.push({
        name: `${s.source_name}.${s.name}`,
        path: s.original_file_path // Sources define path to .yml usually
      });
    }
  });

  // 3. Downstream Dependencies
  // We must iterate all nodes to see if *they* depend on *us*
  const downstream = [];
  for (const node of Object.values(nodes)) {
    if (node.resource_type !== 'model') continue;

    const deps = (node.depends_on && node.depends_on.nodes) ? node.depends_on.nodes : [];
    if (deps.includes(currentNodeId)) {
      downstream.push({
        name: node.name,
        path: node.original_file_path
      });
    }
  }

  return {
    current: {
      name: currentNode.name,
      path: currentNode.original_file_path
    },
    upstream: upstream,
    downstream: downstream
  };
}

// --- TEMPLATE LOADERS ---

function loadWebviewTemplate(extensionUri) {
  const templatePath = path.join(extensionUri.fsPath, "webview.html");
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