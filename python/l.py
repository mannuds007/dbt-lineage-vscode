#!/usr/bin/env python3

import json
import sys
from pathlib import Path


def fail(msg: str):
    print(json.dumps({"error": msg}))
    sys.exit(1)


def load_manifest(project_root: Path) -> dict:
    manifest_path = project_root / "target" / "manifest.json"
    if not manifest_path.exists():
        fail("target/manifest.json not found. Run dbt build first.")
    return json.loads(manifest_path.read_text())


def find_model(manifest: dict, model_name: str):
    for node_id, node in manifest.get("nodes", {}).items():
        if node.get("resource_type") == "model" and node.get("name") == model_name:
            return node_id, node
    return None, None


def main():
    if len(sys.argv) != 2:
        fail("Model name required")

    model_name = sys.argv[1]
    project_root = Path.cwd()

    manifest = load_manifest(project_root)
    node_id, node = find_model(manifest, model_name)

    if not node:
        fail(f"Model '{model_name}' not found in manifest")

    upstream = []
    for parent_id in node.get("depends_on", {}).get("nodes", []):
        parent = manifest["nodes"].get(parent_id)
        if parent and parent.get("resource_type") == "model":
            upstream.append({
                "name": parent["name"],
                "path": parent["original_file_path"]
            })

    downstream = []
    for other_id, other in manifest["nodes"].items():
        if other.get("resource_type") != "model":
            continue
        if node_id in other.get("depends_on", {}).get("nodes", []):
            downstream.append({
                "name": other["name"],
                "path": other["original_file_path"]
            })

    output = {
        "current": {
            "name": node["name"],
            "path": node["original_file_path"]
        },
        "upstream": upstream,
        "downstream": downstream
    }

    print(json.dumps(output))


if __name__ == "__main__":
    main()
