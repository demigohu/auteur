"""Write the timeline JSON Schema for the frontend, which generates its TypeScript types from it."""

import json
from pathlib import Path

from pydantic import BaseModel, TypeAdapter

from auteur.timeline import Op, Project


class Schema(BaseModel):
    """Root that pulls every shared type into one schema."""

    project: Project
    op: Op


def drop_field_titles(node: object) -> None:
    """Field titles make json2ts emit an alias per field (Id1, Name1, ...); model titles stay."""
    if isinstance(node, dict):
        for prop in node.get("properties", {}).values():
            prop.pop("title", None)
        for value in node.values():
            drop_field_titles(value)
    elif isinstance(node, list):
        for value in node:
            drop_field_titles(value)


out = Path(__file__).resolve().parents[2] / "web/src/lib/timeline.schema.json"
out.parent.mkdir(parents=True, exist_ok=True)
schema = TypeAdapter(Schema).json_schema(mode="serialization")
drop_field_titles(schema)
out.write_text(json.dumps(schema, indent=2) + "\n")
print(f"wrote {out}")
