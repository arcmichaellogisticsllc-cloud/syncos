# 014 KPIs, Learning

## Purpose

Store metrics, observations, model feedback, and learning artifacts used to improve decisions.

## Tables

- `kpi_definitions`: metric definitions and calculation metadata.
- `kpi_values`: calculated KPI observations.
- `learning_datasets`: named training or evaluation datasets.
- `learning_examples`: examples with labels and source references.
- `model_runs`: scoring, training, or evaluation runs.
- `model_run_metrics`: performance metrics from model runs.
- `prediction_outcomes`: actual outcomes linked to prior predictions or recommendations.

## Key Relationships

- `kpi_definitions.tenant_id` references `tenants.id`.
- `kpi_values.kpi_definition_id` references `kpi_definitions.id`.
- `learning_datasets.tenant_id` references `tenants.id`.
- `learning_examples.dataset_id` references `learning_datasets.id`.
- `model_runs.tenant_id` references `tenants.id`.
- `model_run_metrics.model_run_id` references `model_runs.id`.

## Notes

- Preserve model version, feature version, training window, and evaluation window.
- KPI values should support entity-scoped and tenant-wide measurements.
