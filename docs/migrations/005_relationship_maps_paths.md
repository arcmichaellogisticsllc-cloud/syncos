# 005 Relationship Maps, Paths

## Purpose

Represent computed relationship graphs and useful paths between entities.

## Tables

- `relationship_maps`: named graph snapshots or map configurations.
- `relationship_map_nodes`: contacts, organizations, territories, or opportunities in a map.
- `relationship_map_edges`: graph edges with strength, type, and confidence.
- `relationship_paths`: computed paths between source and target entities.
- `relationship_path_steps`: ordered edges that compose a path.

## Key Relationships

- `relationship_maps.tenant_id` references `tenants.id`.
- `relationship_map_nodes.map_id` references `relationship_maps.id`.
- `relationship_map_edges.map_id` references `relationship_maps.id`.
- `relationship_paths.map_id` references `relationship_maps.id`.
- `relationship_path_steps.path_id` references `relationship_paths.id`.

## Notes

- Keep computed graph artifacts separate from raw relationships.
- Include algorithm name, version, score, and generated timestamp.
