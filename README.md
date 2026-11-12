# Nova Business · Panel de Control (NOVA + Odoo 16)

Plataforma de análisis multiempresa con datos **diferidos al cierre anterior**: addons ligeros Odoo 16
preparan lotes nocturnos → el worker NOVA los recoge (desde 03:00 America/Guayaquil), valida, confirma
y publica en PostgreSQL central → API → frontend React y MCP. No es tiempo real y nunca consulta Odoo al
abrir una vista. Estado real de cada entrega y bloqueos: **[docs/STATUS.md](docs/STATUS.md)**.

| Carpeta | Contenido |
|---|---|
| `src/` | Frontend React/TS/Vite (13 reportes + 12 vistas auxiliares). Modo demo explícito sin `VITE_NOVA_API_URL`; modo real contra la API. |
| `server/`, `api/` | API NOVA (Node `http`): sesión, tenants, reportes, CSV, fuentes, Factory, tareas, MCP. |
| `worker/`, `lib/ingest/` | Scheduler, recolección, aplicación idempotente, transformaciones y publicación. |
| `lib/` | Configuración, BD (RLS por transacción), contratos (Ajv), cifrado, SSRF, métricas. |
| `sql/migrations/` | Migraciones versionadas (`npm run migrate`). |
| `contracts/` | `nova.export.v1`: manifest, parte y 31 datasets (JSON Schema, generados desde los addons). |
| `odoo_addons/` | 9 addons Odoo 16 (`nova_connector`, `nova_master_data`, `nova_sales`, `nova_account`, `nova_stock`, `nova_stock_account`, `nova_purchase`, `nova_pos`, `nova_juj`). Guía: `odoo_addons/nova_connector/README.md`. |
| `infra/`, `.github/` | Docker Compose de staging (incluye Odoo 16 desechable) y CI (Node, Python 3.8, Odoo 16 real). |
| `docs/` | Estado, arquitectura, operación/runbooks, métricas, campos y matriz de 166 bloques. |
| `tests/` | Pipeline e API sobre PostgreSQL real (PGlite), worker, frontend SSR, preservación del demo; `tests/py` para la librería del conector. |

## Desarrollo

Node ≥ 22.12 y Python ≥ 3.8.

```
npm ci
npm run dev              # frontend en modo demo (http://localhost:3000)
npm test                 # pruebas Node
npm run test:py          # pruebas Python + contratos + verificación de addons
npm run build
npm run addons:zip       # dist/nova_odoo16_addons.zip (carpetas de addon en la raíz)
npm run docs:blocks      # regenera docs/BLOCKS_MATRIX.md
```

Modo real local: PostgreSQL 15, `.env` desde `.env.example`, `npm run migrate`, `npm run api`,
`npm run worker` y `VITE_NOVA_API_URL=http://localhost:8787 npm run dev`. Staging completo:
`docs/OPERATIONS.md`.

## Despliegue

- **Frontend (Vercel)**: build `npm run build`, salida `dist`. `.vercelignore` excluye backend, addons e
  infraestructura; `/api/*` no se reescribe a `index.html`. Sin `VITE_NOVA_API_URL` se publica el demo
  etiquetado.
- **API + worker + PostgreSQL**: servidor central detrás de TLS (`infra/Dockerfile`). Nunca exponer
  PostgreSQL ni credenciales ERP al navegador.
- **Odoo**: instalar addons primero en staging; producción del cliente solo con autorización explícita.

## Fidelidad del demo

`reference/client-original.html` es referencia de auditoría. `src/data/report.json` es el fixture del
modo demo; la prueba de preservación compara el texto de las 13 vistas con el original. En modo real
ningún número de ese fixture se muestra: cada bloque se calcula en NOVA o aparece como "Sin dato".
