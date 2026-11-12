# Estado de la misión NOVA + Odoo 16

Actualizado: 2026-11-11. Rama: `main` (decisión explícita del propietario). Commit base: `d3271f8`
(= ZIP auditado `controlpanel-main.zip`, sin diferencias de código).

Leyenda de columnas: **Impl.** código escrito · **Local** probado automáticamente en esta máquina ·
**Odoo16** probado en una base Odoo 16 real · **Cliente** validado con JUJ/su servidor.
`✔` sí · `◐` parcial · `—` no.

## F0 · Reconocimiento (HEAD vs inventario)

- HEAD coincide con el ZIP auditado; árbol limpio; sin `AGENTS.md`; no existía rama NOVA propia.
- Línea base: con Node 22.23 pasaban 6/6 pruebas y el build; con Node 18 (PATH por defecto de esta
  máquina) fallaba la prueba de preservación porque Vite 8 exige Node ≥ 22.12 (no es regresión).
- Confirmado del inventario: tenant de UI sin efecto en datos; contrato v1 insuficiente; validador sin
  negativos; worker contra vista inexistente; API con snapshot global; auth Basic compartida;
  Vercel excluye backend; tokens locales poco fiables; textos de "registrada"/"tiempo real" sin soporte.
- Entorno: sin Docker, sin PostgreSQL ni Odoo locales → PostgreSQL real vía PGlite (WASM) para pruebas
  centrales; Odoo 16 real vía CI (GitHub Actions, imagen oficial `odoo:16.0`).

## Matriz por entrega

| Fase / entrega | Impl. | Local | Odoo16 | Cliente | Evidencia / pendiente |
|---|---|---|---|---|---|
| F1 Contratos JSON Schema (manifest, parte, 31 datasets) | ✔ | ✔ | — | — | `contracts/`; generados desde los `nova_spec.py` (Python) y validados en Node (Ajv estricto). Prueba de sincronía Python↔Node. |
| F1 Migraciones centrales versionadas (app/ingest/staging/core/mart/ops) | ✔ | ✔ | n/a | — | `sql/migrations/0000-0005`, checksum + lock; legado `trueque_requests` copiado sin borrar. Probado en PostgreSQL 18 (PGlite); objetivo PG15. |
| F1 Auth/sesiones/roles/membresías + RLS | ✔ | ✔ | n/a | — | scrypt + cookie HttpOnly + anti-CSRF; RLS por `nova.tenant_id` transaccional; rol API sin acceso a secretos. Pruebas negativas de acceso cruzado (API, MCP, SQL directo). Proveedor de identidad definitivo: pendiente (M11). |
| F1 Fixtures de dos tenants | ✔ | ✔ | — | — | `tests/fixtures/batches` generados por la librería Python del addon (mismos ids en ambas fuentes). |
| F2 `nova_connector` (conexión, vinculación, outbox, lotes, partes, cursores, RPC, crons, retención, cuotas, clones) | ✔ | ◐ | ⏳ CI | — | Lógica pura 13/13 (Py 3.10/3.12); verificación estática (Py 3.8, XML, ACL). Pruebas Odoo en `tests/` del addon: se ejecutan en el job `odoo16` de CI. |
| F2 `nova_master_data` | ✔ | ◐ | ⏳ CI | — | Captura create/write/unlink, rollback, commits fuera de orden, archivado, fuera de alcance, PII excluida, límites de parte. |
| F3 `nova_sales`, `nova_account`, `nova_stock`, `nova_stock_account`, `nova_purchase`, `nova_pos` | ✔ | ◐ | ⏳ CI | — | Validación de nombres de campo contra Odoo 16 instalado en CI; pago/conciliación → cartera; NC; quants. POS: solo verificación de campos (sin escenario de sesión). |
| F3 `nova_juj` (adaptador) | ✔ | ◐ | ⏳ CI | — | Sin nombres técnicos JUJ: mapeo configurable de marca/unidad/canal/zona/cantón. Campos reales: **pendiente JUJ**. |
| F3 Ingesta central (descarga, checksum, límites, ACK, aplicación idempotente, cascadas, snapshot/resync, conciliación, publicación) | ✔ | ✔ | — | — | `tests/pipeline.test.mjs` 10/10: M4.4 casos 1-8, corrupto/truncado/versión/gap/tamaño/generación, ACK perdido, caída a mitad. |
| F4 API semántica + reportes reales (Dirección, Comercial, 4 unidades, inventario, cartera básica) | ✔ | ✔ | — | — | `tests/api.test.mjs` 15/15: cifras cambian con filtro y concilian con fixtures; sin números demo en modo real; sin consulta ERP al visualizar. Cartera: API `/api/receivables` (sin pantalla propia aún). |
| F4 Frontend (modo real/demo, corte, carga/error/sin datos, CSV, filtros reales, fuentes de datos, login) | ✔ | ✔ | n/a | — | Preservación del demo 2/2; prueba SSR de modo real; build OK. QA visual en navegador/móvil/impresión: **pendiente**. |
| F5 Compras, logística, clientes avanzados, finanzas completas | ◐ | — | — | — | Datos ya exportados (compras, movimientos, pickings, apuntes). Marts/métricas: pendientes de mapeo contable y definiciones. |
| F6 Tareas/notas/umbrales/Factory/Market/planes | ◐ | ✔ | n/a | — | API de tareas/notas/umbrales/Factory (idempotente, términos versionados) ✔; UI de tareas/notas aún local; Market sin falsa confirmación; tokens: simulación corregida y etiquetada; ledger de planes: tabla creada, lógica pendiente de definición comercial. |
| F7 MCP analítico | ◐ | ✔ | n/a | — | `/mcp` con `list_tenants`, `get_data_freshness`, `get_dashboard`, `get_metric_definition`, reautorización por llamada. Backend LLM: **pendiente** (proveedor/presupuesto). |
| F8 Compose staging, CI, ZIP, runbooks | ✔ | ◐ | ⏳ CI | — | `infra/`, `.github/workflows/ci.yml`, `npm run addons:zip`, `docs/OPERATIONS.md`. Compose no ejecutado aquí (sin Docker). Mediciones de recursos 2 CPU/2 GB: **no realizadas**. |

`⏳ CI`: el job `odoo16` instala, prueba y actualiza (`-i`, `--test-enable`, `-u`) los 9 addons sobre
una base desechable; su resultado se registra en el reporte de entrega. Hasta que pase, no considerar
los addons "probados en Odoo 16".

## Definición mínima "enlace NOVA–Odoo funciona" (M10)

| Requisito | Estado |
|---|---|
| Addon instalado en Odoo 16 de pruebas | ⏳ CI |
| Fuente enlazada a tenant/compañías | Implementado (worker `link`), probado con transporte fixture; contra Odoo real: pendiente staging |
| Carga inicial + ≥2 deltas con altas/cambios/bajas | Probado con lotes producidos por la librería del addon; con Odoo real: pendiente staging |
| Recibos y reintentos idempotentes | ✔ local |
| Publicación central conciliada | ✔ local (conciliación de conteos y sumas de id; cifras fixture) |
| Reporte real con filtro | ✔ local |
| Aislamiento probado | ✔ local (API, MCP, RLS SQL) |

**Conclusión:** el enlace **no** está demostrado extremo a extremo contra un Odoo 16 vivo; está
implementado y probado por partes. Falta la ejecución en staging con Odoo 16 + NOVA juntos.

## Bloqueos reales (M11) — solo bloquean lo que depende de ellos

1. **Odoo 16 de JUJ**: URL, base, versión PostgreSQL/Python, módulos instalados, volumen y horarios de
   backup/cierre POS. Bloquea: dimensionamiento, ventana real, validación de campos personalizados.
2. **Campos JUJ** de marca/unidad/zona/cantón/canal y tabla de unidades de negocio (compañía/diario/POS).
   Bloquea: filtros por marca/zona reales y atribución de unidades (hoy reglas de fixture).
3. **Fuente canónica de ventas** (factura vs POS vs pedido), moneda y criterio de costo. La regla
   implementada (factura publicada + POS sin factura; costo COGS anglosajón o costo POS) es una
   **propuesta**.
4. **Presupuestos/metas, ISE, mapeo contable** (finanzas, punto de equilibrio). Bloquea 130 bloques.
5. **Servidor central y proveedor de identidad/secretos**; dominio del API y CORS para Vercel.
6. **Planes, precios, términos legales**: textos actuales son del boceto; registrar versión con
   `npm run admin -- terms` solo tras aprobación.
7. **Acceso a Docker/staging** para medir recursos y probar Compose.

## Próximos pasos concretos

1. Revisar el resultado del job `odoo16` de CI y corregir lo que falle.
2. Levantar `infra/compose.staging.yml`, vincular el Odoo 16 de staging, correr 3 noches simuladas
   (`Preparar lote ahora`) y medir CPU/RAM/duración SQL/bytes con el límite 2 CPU/2 GB.
3. Taller con JUJ: campos personalizados, unidades, fuente de ventas, presupuesto; aprobar métricas v1.
4. Desplegar API + worker + PostgreSQL 15 en el servidor central (TLS) y configurar `VITE_NOVA_API_URL`.
5. Conectar UI de tareas/notas a la API; detalle de solicitudes Factory; backend LLM para el copiloto.
