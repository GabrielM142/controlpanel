# Operación y despliegue

## Componentes

| Servicio | Comando | Rol BD | Notas |
|---|---|---|---|
| Frontend | `npm run build` (Vercel) | — | `VITE_NOVA_API_URL` vacío ⇒ modo demo explícito. Sin secretos en `VITE_*`. |
| API | `npm run api` | `nova_api` | Detrás de TLS. `NOVA_CORS_ORIGINS` = dominio exacto del frontend. `/health/live`, `/health/ready` sin datos. |
| Worker | `npm run worker` | `nova_worker` | Proceso separado. Nunca lo dispara un visitante. |
| Migraciones | `npm run migrate` | owner | Una transacción por archivo; checksum; no editar migraciones aplicadas. |

### Producción actual: Vercel + Neon (desde 2026-11-12)

| Pieza | Dónde | Variables |
|---|---|---|
| Panel | `dist/` (Vite) | `VITE_NOVA_API_URL=https://controlpanel-gamma.vercel.app` solo en Production (Preview queda en demo) |
| API | función `api/index.mjs` (rewrites `/api/*`, `/health/*`, `/mcp`) | `APP_MODE=live`, `NOVA_SECRET_KEY`, `OMEGA_DATABASE_URL` (Neon pooled) |
| Carga nocturna | Vercel Cron `*/5 * * * *` → `api/cron.mjs` (= `worker/run.mjs --once`) | `CRON_SECRET`, `OMEGA_DATABASE_URL_UNPOOLED` (advisory locks) |
| Base | Neon `omega-db` (iad1), integración con prefijo `OMEGA` | La `DATABASE_URL` antigua del boceto se ignora a propósito |

Migraciones y altas se ejecutan desde una máquina de operador con la URL directa:
`vercel env pull` → `node --env-file=<archivo con DATABASE_URL=OMEGA_DATABASE_URL_UNPOOLED> sql/migrate.mjs`.
Las funciones se conectan como dueño de la base y bajan privilegios con `SET LOCAL ROLE nova_api|nova_worker`
(migración 0006 en PostgreSQL 16+). Rollback de despliegue: `vercel rollback` o `git revert`.

Piloto: API, worker y PostgreSQL 15 pueden compartir una VM con pools acotados (`PGPOOL_MAX`) y
`NOVA_WORKER_CONCURRENCY`. Dimensionar tras medir; no hay número de clientes garantizado.

## Staging Odoo 16 conectado (2026-11-12)

| Pieza | Valor |
|---|---|
| Servidor | `omega-test` (Ubuntu 20.04, 2 CPU, 3,8 GB), Odoo 16.0+e como servicio `odoo16`, base `gca` |
| Addons NOVA | `/opt/odoo16/core/nova` (agregado al final de `addons_path`); 9 instalados, `nova_website_sale` no (sin `website_sale`) |
| HTTPS para el worker | `https://159-203-88-214.sslip.io` → nginx → `127.0.0.1:8069` (Let's Encrypt, renovación automática de certbot) |
| Usuario técnico | `nova.integracion`: solo "Usuario interno" + "Usuario técnico integración NOVA"; API key "OMEGA NOVA" cifrada en OMEGA |
| Respaldo previo | `/var/backups/nova/gca-antes-nova-20261112-1300.dump` (`pg_restore -d gca --clean`) y `/root/nova-backup/odoo16.conf.bak-20261112` |
| Pruebas en el propio Odoo | base desechable `nova_test` con todos los addons del cliente: 39/39 |
| Carga histórica | `max_pending_bytes` = 5,5 MB **comprimidos** por lote (~180 mil filas, ~85 MB sin comprimir, ~7 min de aplicación central, bajo el límite de 800 s de Vercel) |

Reversión en staging: desinstalar los `nova_*` desde Aplicaciones (o restaurar el respaldo), quitar
`/opt/odoo16/core/nova` del `addons_path`, borrar `/etc/nginx/sites-enabled/nova-staging` y reiniciar `odoo16`.

## Alta de un cliente

1. `npm run migrate`; crear roles de login: `CREATE ROLE nova_api_login LOGIN PASSWORD '…' IN ROLE nova_api;`
   (ídem `nova_worker_login`) y usar esas credenciales en `DATABASE_URL` de cada servicio.
2. `npm run admin -- create-tenant juj "JUJ"`; `NOVA_NEW_PASSWORD=… npm run admin -- create-user …`;
   `npm run admin -- grant <email> juj owner`; `npm run admin -- terms` (solo términos aprobados).
3. En Odoo (staging primero): instalar addons, usuario técnico + API key, compañías y ventana,
   "Generar código de vinculación" (ver `odoo_addons/nova_connector/README.md`).
4. En NOVA → Ajustes → Fuentes de datos: registrar la fuente y vincular con el código. El worker
   confirma la vinculación, guarda instalación/generación y compañías.
5. Reglas de unidad: `npm run admin -- unit-rule juj <source> company 1 MH "Mayorista Hogar" Mayorista`
   (validadas con JUJ) y `npm run admin -- rebuild <source>`.

## Runbooks

| Situación | Acción |
|---|---|
| Cliente sin lote listo a las 03:00 | El worker reintenta cada 30 min hasta 6 h después; luego al día siguiente. Revisar en Odoo → NOVA → Lotes. |
| Lote rechazado (checksum/esquema/versión) | Queda `rejected` y bloquea los siguientes. Corregir en origen (cancelar lote en Odoo ⇒ eventos vuelven a pendiente) o actualizar contrato. No borrar `ingest.runs`. |
| Fallo al aplicar/publicar | Rollback total; última versión publicada intacta. Partes guardadas: el siguiente ciclo reintenta sin descargar. Ver `ingest.runs.error`. |
| ACK perdido | Automático: el siguiente ciclo vuelve a confirmar (idempotente en Odoo). |
| Disco/cola en el cliente | Odoo detiene la preparación al superar `max_pending_bytes`. Si hay que proteger el ERP: "Desactivar captura (emergencia)" ⇒ resync requerido. |
| Diferencia en conciliación | `ops.data_quality_results` con `fail`. Pedir resync del dataset (`POST /api/sources/:id/resync`). |
| Base Odoo restaurada/clonada | Odoo suspende la conexión; NOVA marca `relink_required`. Re-vincular solo si es la fuente legítima; los datos centrales se conservan. |
| Pausar una fuente | `POST /api/sources/:id/pause` (o en Odoo "Pausar"). La UI sigue mostrando el último corte. |
| Rotar API key | Generar nueva key en Odoo; `POST /api/sources/:id/rotate`; revocar la anterior. |
| Rollback de versión de código | Desplegar versión anterior; migraciones solo hacia adelante (escribir migración correctiva). Restaurar backup si hubo pérdida. |

## Respaldos

- PostgreSQL central: `pg_dump` diario + WAL/PITR según proveedor; probar restauración en staging
  trimestralmente. `NOVA_SECRET_KEY` en secret manager con copia de recuperación (sin ella no se
  descifran credenciales: re-registrar API keys).
- Coordinar la ventana de Odoo con sus backups/cierres POS: 00:00 no garantiza servidor ocioso.

## Medición de recursos (pendiente de ejecutar)

Escenario: Odoo 16 + PostgreSQL en contenedor limitado a 2 CPU / 2 GB (`infra/compose.staging.yml`).
Medir baseline vs preparación: p95 de operaciones ERP, CPU, RSS, I/O, duración SQL, locks, tamaño de
cola/partes y bytes. Casos: cero cambios, cambios pequeños, cambio masivo, recuperación de varios días.
Fijar `max_rows_per_part`, `time_budget_seconds` y umbrales de pausa con esas cifras; no antes.

## Pruebas

```
npm test                 # Node: pipeline, API/seguridad, worker, frontend SSR, preservación demo
npm run test:py          # Python: librería del conector, contratos, verificación estática, fixtures
sh scripts/odoo16-test.sh  # Odoo 16 real en staging (también en CI, job odoo16)
```
