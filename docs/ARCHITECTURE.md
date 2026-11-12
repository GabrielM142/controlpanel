# Arquitectura NOVA (carga nocturna incremental)

```
Odoo 16 (cliente)                         NOVA central                                   Navegador
┌───────────────────────────┐   HTTPS    ┌──────────────────────────────────────────┐   ┌──────────┐
│ nova_connector + addons   │  JSON-RPC  │ worker  ──► ingest.runs/parts (gzip)     │   │ React    │
│  outbox (misma txn)       │◄───────────│   validar checksum/esquema → ACK          │   │ (Vercel) │
│  cron 00:00 → lotes ready │  usuario   │   aplicar → staging → core → mart         │   └────┬─────┘
│  partes inmutables        │  técnico + │   publicar versión (ops.published_versions)│        │ cookie
│  ACK / retención / cuotas │  API key   │ API (rol nova_api + RLS) ◄─────────────────┼────────┘ HttpOnly
└───────────────────────────┘            │ MCP /mcp (mismas reglas)                   │
                                         └──────────────────────────────────────────┘
```

## Protocolo `nova.export.v1`

1. **Captura**: `nova.capture.mixin` crea `nova.change.event` en la misma transacción que
   `create/write/unlink` (rollback ⇒ sin evento). Fallo de captura ⇒ resync requerido (nunca silencioso).
2. **Preparación** (cron cada 15 min dentro de la ventana local, una por base, transacción por
   invocación limitada por tiempo/partes, `_trigger()` para continuar):
   carga histórica por `id` → eventos asignados por **run_id exacto** (no `id > último`) → barrido
   `(write_date, id)` con solapamiento. Partes ≤ 250 filas y ≤ 512 KiB sin comprimir (configurable).
3. **Manifest** inmutable: `business_date`, `requested_cutoff_at`, `observed_from/to`,
   `consistency: captured_interval`, partes con sha256 sobre bytes sin comprimir, conciliación por compañía.
4. **Recogida** (worker desde 03:00 America/Guayaquil + jitter estable por fuente, concurrencia global
   limitada, bloqueo por fuente): solo lotes `ready`; descarga por partes con límites de expansión;
   valida esquema y compañías; persiste; **ACK solo después** de tener todas las partes.
5. **Aplicación** (una transacción): upsert/baja lógica con orden `(run_seq, seq)`; cascadas declaradas;
   `snapshot_replace` solo con manifiesto completo y alcance explícito; resync por época; conciliación;
   reconstrucción de core y marts **solo para claves/fechas afectadas (antes y después)**; publicación.
   Si algo falla: rollback completo, se conserva la última versión publicada y las partes guardadas.

Estados origen: `pending → preparing → ready → acknowledged` (+ `failed/cancelled`).
Estados NOVA: `discovered → downloading → validated → applied → published` (+ `failed/rejected`).
Un lote rechazado bloquea los siguientes de esa fuente (no se aplica fuera de orden).

## Datos centrales

| Esquema | Contenido |
|---|---|
| `app` | tenants, usuarios, membresías, compañías por miembro, fuentes, credenciales cifradas, reglas de unidad, Factory, tareas, notas, umbrales, ledger |
| `ingest` | runs, parts (payload gzip), receipts |
| `staging` | estado canónico por registro fuente (jsonb) + auditoría antes/después |
| `core` | dimensiones (compañía, socio, producto, usuario) y hechos (venta unificada, pedidos, cartera, quants, valoración) |
| `mart` | `sales_day` (+ vista `sales_month`), `receivable_day`, `inventory_day`, `executive_snapshot` |
| `ops` | checkpoints, calidad, versiones publicadas, comandos de fuente, auditoría |

Aislamiento: todas las tablas con `tenant_id` tienen RLS; el contexto `nova.tenant_id` se fija con
`set_config(..., true)` dentro de cada transacción (no se filtra entre requests del pool). La API usa
`nova_api` (no owner, no BYPASSRLS); el worker `nova_worker`; las migraciones el owner. Las credenciales
ERP solo las lee el worker. Dimensiones "como es ahora"; SCD2 solo cuando el negocio lo pida.

## Decisiones documentadas

- Transporte: RPC nativo Odoo 16 (`/jsonrpc`, `execute_kw`) con usuario dedicado + API key; solo métodos
  de `nova.connector`. Sin controladores `auth='none'`.
- Contenido de partes en adjuntos privados (`ir.attachment` ligado a `nova.sync.part`, gzip), no base64
  en tablas ORM; purga solo tras ACK + retención.
- Clones: huella (nombre BD + `database.uuid` + fecha de creación) ⇒ suspensión; `neutralize.sql`;
  re-vinculación crea nueva generación; NOVA rechaza otra generación y no borra datos.
- Réplica física/CDC/streaming: fuera del MVP (interfaz `kind = pg_replica_future` reservada).
