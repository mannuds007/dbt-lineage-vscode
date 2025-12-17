const vscode = require("vscode");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
function activate(context) {
  const command = vscode.commands.registerCommand(
    "dbtLineage.show",
    async () => {

      // 1. Ensure a workspace is open
      if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage(
          "Please open a dbt project folder first."
        );
        return;
      }

      const workspaceRoot =
        vscode.workspace.workspaceFolders[0].uri.fsPath;


      // 2. Ask for model name

      const model = await vscode.window.showInputBox({
        prompt: "Enter dbt model name"
      });

      if (!model) return;

      // 3. Resolve l.py inside extension
      

      const extensionRoot = context.extensionUri.fsPath;
      const pythonScript = path.join(
        extensionRoot,
        "python",
        "l.py"
      );

      

      if (!fs.existsSync(pythonScript)) {
        vscode.window.showErrorMessage(
          "l.py not found inside extension."
        );
        return;
      }

      // 4. Execute Python (cwd = dbt project root)
      let result;
      try {
        result = execSync(
          `python "${pythonScript}" ${model}`,
          {
            cwd: workspaceRoot,
            encoding: "utf-8"
          }
        );
      } catch (e) {
        vscode.window.showErrorMessage(
          e.stderr?.toString() || e.message
        );
        return;
      }



      const panel = vscode.window.createWebviewPanel(
      "dbtLineage",
      `Lineage: ${model}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true }
      );

      panel.webview.html = getHtml(panel.webview, context.extensionUri);


      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch (e) {
        vscode.window.showErrorMessage("Invalid lineage JSON output.");
        return;
      }


      panel.webview.onDidReceiveMessage(msg => {
        if (msg && msg.type === "ready") {
          panel.webview.postMessage(parsed);
          return;
        }
        if (msg && msg.openFile) {
          const filePath = path.join(workspaceRoot, msg.openFile);
          vscode.window.showTextDocument(vscode.Uri.file(filePath));
        }
      });
    });

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
      <meta
        http-equiv="Content-Security-Policy"
        content="
          default-src 'none';
          script-src ${webview.cspSource} 'nonce-${nonce}';
          style-src ${webview.cspSource} 'unsafe-inline';
        "
      >
      <style>
        html, body, #cy {
          width: 100%;
          height: 100%;
          margin: 0;
        }
      </style>
    </head>
    <body>
      <div id="cy"></div>

      <script src="${scriptUri}"></script>
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function render(data) {
          if (!data || !data.current) return;

          const elements = [];
          const nodeIds = new Set();
          function addNode(id) {
            if (!nodeIds.has(id)) {
              nodeIds.add(id);
              elements.push({ data: { id } });
            }
          }

          addNode(data.current.name);

          (data.upstream || []).forEach(u => {
            addNode(u.name);
            elements.push({ data: { source: u.name, target: data.current.name } });
          });

          (data.downstream || []).forEach(d => {
            addNode(d.name);
            elements.push({ data: { source: data.current.name, target: d.name } });
          });

          const cy = cytoscape({
            container: document.getElementById("cy"),
            elements,
            style: [
              {
                selector: "node",
                style: {
                  label: "data(id)",
                  shape: "round-rectangle",
                  "width": 200,
                  "background-color": "#007acc",
                  color: "#fff",
                  "text-valign": "center",
                  "text-halign": "center",
                  padding: "10px"
                }
              },
              {
                selector: "edge",
                style: {
                  width: 2,
                  "line-color": "#999",
                  "curve-style": "bezier",
                  "control-point-step-size": 40,
                  "line-cap": "round",
                  "target-distance-from-node": 6,
                  "target-arrow-shape": "triangle",
                  "target-arrow-color": "#999",
                  "arrow-scale": 1.6
                }
              }
            ],
            layout: {
              name: "breadthfirst",
              directed: true,
              transform: (node, pos) => ({ x: pos.y, y: pos.x })
            } 
          });

          cy.on("tap", "node", evt => {
            vscode.postMessage({ openFile: evt.target.id() + ".sql" });
          });
        }

        window.addEventListener("message", event => {
          render(event.data);
        });

        window.addEventListener("DOMContentLoaded", () => {
          vscode.postMessage({ type: "ready" });
        });
      </script>
    </body>
    </html>
  `;
}


function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}


exports.activate = activate;

