
A dbt local cli VS Code extension that visualizes **1-step upstream and downstream lineage** for dbt models using `manifest.json`


## Installation

1. Download the extension package:

  Extension: https://github.com/mannuds007/dbt-lineage-vscode/dbt-lineage-local-0.1.1.vsix
  
2. Install locally:

   ```bash
   code --install-extension dbt-lineage-local-0.1.1.vsix --force
   ```
3. Restart VS Code.

---

## How to use

1. Open a dbt project folder in VS Code
2. Open Command Palette (`Ctrl / Cmd + Shift + P`)
3. Run:

   ```
   Show dbt Lineage (1-step)
   ```
4. Enter a model name to view its lineage
