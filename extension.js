const vscode = require("vscode");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

let lineagePanel; // reusable panel reference

function activate(context) {
  const command = vscode.commands.registerCommand(
    "dbtLineage.show",
    async () => {

      // Ensure workspace
      if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage("Please open a dbt project folder first.");
        return;
      }

      const workspaceRoot =
        vscode.workspace.workspaceFolders[0].uri.fsPath;

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

      const model = path.basename(
        activeFilePath,
        path.extname(activeFilePath)
      );

      // Validate dbt project
      if (!fs.existsSync(path.join(workspaceRoot, "dbt_project.yml"))) {
        vscode.window.showErrorMessage("Not a dbt project.");
        return;
      }

      // Resolve Python script
      const pythonScript = path.join(
        context.extensionUri.fsPath,
        "python",
        "l.py"
      );

      if (!fs.existsSync(pythonScript)) {
        vscode.window.showErrorMessage("l.py not found inside extension.");
        return;
      }

      // Run Python
      let lineageData;
      try {
        const result = execSync(
          `python "${pythonScript}" ${model}`,
          { cwd: workspaceRoot, encoding: "utf-8" }
        );
        lineageData = JSON.parse(result);
      } catch (e) {
        vscode.window.showErrorMessage(
          e.stderr?.toString() || "Failed to generate lineage."
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
            retainContextWhenHidden: true
          }
        );

        lineagePanel.webview.html = getHtml(
          lineagePanel.webview,
          context.extensionUri
        );

        lineagePanel.onDidDispose(() => {
          lineagePanel = undefined;
        });

        lineagePanel.webview.onDidReceiveMessage(msg => {
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
    }
  );

  context.subscriptions.push(command);
}

function getHtml(webview, extensionUri) {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "cytoscape.min.js")
  );

  const nonce = getNonce();

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 script-src ${webview.cspSource} 'nonce-${nonce}';
                 style-src ${webview.cspSource} 'unsafe-inline';">
  <style>
    html, body, #cy {
      width: 100%;
      height: 100%;
      margin: 0;
      background: #1e1e1e;
    }
  </style>
</head>
<body>
  <div id="cy"></div>

  <script src="${scriptUri}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let cy;

    function render(data) {
      if (!data || !data.current) return;

      const elements = [];
      const nodeIds = new Set();

      function addNode(node) {
        if (!nodeIds.has(node.name)) {
          nodeIds.add(node.name);
          elements.push({
            data: {
              id: node.name,
              filePath: node.path
            }
          });
        }
      }

      addNode(data.current);

      (data.upstream || []).forEach(u => {
        addNode(u);
        elements.push({ data: { source: u.name, target: data.current.name } });
      });

      (data.downstream || []).forEach(d => {
        addNode(d);
        elements.push({ data: { source: data.current.name, target: d.name } });
      });

      if (cy) {
        cy.elements().remove();
        cy.add(elements);
        cy.layout(cy.options().layout).run();
        return;
      }

      cy = cytoscape({
        container: document.getElementById("cy"),
        elements,
        style: [
          {
            selector: "node",
            style: {
              label: "data(id)",
              shape: "round-rectangle",
              width: 200,
              padding: "10px",
              "background-color": "#007acc",
              color: "#fff",
              "text-valign": "center",
              "text-halign": "center"
            }
          },
          {
            selector: "edge",
            style: {
              width: 2,
              "line-color": "#999",
              "curve-style": "bezier",
              "target-arrow-shape": "triangle",
              "target-arrow-color": "#999",
              "arrow-scale": 1.4
            }
          }
        ],
        layout: {
          name: "breadthfirst",
          directed: true,
          transform: (node, pos) => ({ x: pos.y, y: pos.x })
        }
      });

      // Double click (dbltap) to open file
      cy.on("dbltap", "node", evt => {
        const filePath = evt.target.data("filePath");
        if (filePath) {
          vscode.postMessage({
            openFile: filePath.replace(/\\\\/g, "/")
          });
        }
      });
    }

    window.addEventListener("message", event => {
      render(event.data);
    });
  </script>
</body>
</html>
`;
}

function getNonce() {
  let text = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

exports.activate = activate;
