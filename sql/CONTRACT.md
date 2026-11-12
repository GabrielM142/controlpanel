# Contrato v1 (vista `juj_reporting.controlpanel_v1`) — RETIRADO

El contrato mensual único y la lectura directa de una réplica fueron reemplazados por la arquitectura
de lotes nocturnos: contratos versionados en `contracts/` (`nova.export.v1`), addons Odoo 16 en
`odoo_addons/`, migraciones en `sql/migrations/` y métricas en `lib/metrics.mjs` / `docs/METRICS.md`.

Lecciones que se mantienen: no sumar saldos entre fechas; clientes únicos con DISTINCT; importes con
signo (notas de crédito); no inferir unidades desde nombres; distinguir fecha de negocio de fecha de
extracción. `lib/model.mjs` conserva el contrato v1 solo como fixture del modo demo.
