
A dbt local cli VS Code extension that visualizes **1-step upstream and downstream lineage** for dbt models using `manifest.json`


## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/mannuds007/dbt-lineage-vscode.git
   cd dbt-lineage-vscode
   ```
2. Package the extension:

   ```bash
   vsce package
   ```
3. Install locally:

   ```bash
   code --install-extension dbt-lineage-local-0.1.1.vsix --force
   ```
4. Restart VS Code.

---

## How to use

1. Open a dbt project folder in VS Code
2. Open Command Palette (`Ctrl / Cmd + Shift + P`)
3. Run:

   ```
   Show dbt Lineage (1-step)
   ```
4. Enter a model name to view its lineage
