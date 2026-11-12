# NOVA Connector (`nova_connector`) · Odoo 16

Núcleo de la integración NOVA ↔ Odoo 16 Community: conexión y vinculación, registro de datasets
declarados en código, cola de cambios transaccional (outbox), lotes nocturnos inmutables
fragmentados en partes acotadas, cursores, ACK y retención. Depende solo de `base`.

> Estado: implementado y verificado estáticamente (sintaxis Python 3.8, XML, ACL, manifest) y con
> la lógica pura probada. **Instalación y pruebas sobre una base Odoo 16 real: pendientes** (ver
> `docs/STATUS.md` del repositorio). No instalar en productivo sin esa validación.

## Addons

| Addon | Depende de | Qué exporta |
|---|---|---|
| `nova_connector` | `base` | Nada por sí solo: infraestructura |
| `nova_master_data` | `nova_connector`, `product` | Compañías, contactos, provincias, usuarios, productos, categorías, UoM, monedas |
| `nova_sales` | `nova_master_data`, `sale_management` | Pedidos y líneas (pedido ≠ venta facturada) |
| `nova_account` | `nova_master_data`, `account` | Plan de cuentas, diarios, facturas/NC, apuntes, conciliaciones |
| `nova_stock` | `nova_master_data`, `stock` | Bodegas, ubicaciones, transferencias, movimientos, existencias |
| `nova_stock_account` | `nova_stock`, `nova_account`, `stock_account` | Capas de valoración |
| `nova_purchase` | `nova_master_data`, `purchase_stock` | Compras y líneas |
| `nova_pos` | `nova_account`, `point_of_sale` | Puntos de venta, sesiones, pedidos y líneas POS |
| `nova_website_sale` | `nova_sales`, `website_sale` | Sitios web y canal web de los pedidos (eCommerce) |
| `nova_juj` | `nova_master_data` | Adaptador JUJ: mapeo de atributos a campos personalizados |

Cada addon funcional es opt-in: instalar el conector **no** instala ventas, compras ni POS.

## Instalación (staging primero)

1. Copiar las carpetas `nova_*` (ZIP `dist/nova_odoo16_addons.zip`, carpetas en la raíz) al
   `addons_path` del Odoo 16 correspondiente. Reiniciar el servicio.
2. Instalar: `odoo-bin -c /etc/odoo.conf -d <db> -i nova_connector,nova_master_data,nova_account,nova_sales,nova_stock --stop-after-init`
   (agregar `nova_stock_account`, `nova_purchase`, `nova_pos`, `nova_juj` solo si aplican).
3. Actualizar versiones: `-u nova_connector,...` con la misma lista.
4. Pruebas en una base de pruebas (nunca productiva):
   `odoo-bin -d nova_test -i <addons> --test-enable --test-tags nova --stop-after-init`.

## Usuarios y grupos

| Grupo | Uso |
|---|---|
| Operador NOVA | Ve conexión, datasets, lotes y cola. No descarga contenido de partes. |
| Administrador conector NOVA | Vincula, pausa, limita recursos, compañías autorizadas, cancela lotes. |
| Usuario técnico integración NOVA | **Solo** el usuario dedicado del servidor NOVA. |

Crear un usuario interno dedicado (p. ej. `nova.integracion`) con *únicamente* el grupo
"Usuario técnico integración NOVA" (sin Contabilidad/Ventas/Inventario), generar una API key en
Preferencias → Seguridad de la cuenta y cargarla en NOVA (se guarda cifrada en el servidor, nunca en
el navegador). Ese usuario solo puede invocar `nova.connector`: `get_capabilities`, `confirm_link`,
`list_ready_runs`, `get_manifest`, `read_part`, `ack_run`, `request_resync`. No existe ningún método
genérico de ORM/SQL; el ACK es una escritura técnica sobre artefactos del conector.

## Configuración y vinculación

1. NOVA → Conexión: elegir **compañías autorizadas**, zona horaria y ventana (por defecto 00:00–06:00
   local). Ajustar límites solo tras medir (inicio: 250 filas / 512 KiB sin comprimir por parte,
   20 partes y 45 s por invocación, timeout de consulta 30 s).
2. "Generar código de vinculación" (válido 30 min, se muestra una vez; solo se guarda su hash).
3. En NOVA (Fuentes de datos) registrar URL HTTPS, base, usuario técnico y API key; pegar el código.
   NOVA llama `get_capabilities` + `confirm_link` y asigna el tenant **en el servidor central**.

## Operación del cron

- `NOVA: preparar lote nocturno` despierta cada 15 min, trabaja solo dentro de la ventana, con un
  lote activo por base (bloqueo de fila) y cada invocación limitada por tiempo/partes; se re-dispara
  con `ir.cron._trigger()` hasta terminar. Al cierre de la ventana se finaliza lo preparado (carga
  histórica parcial marcada `backfill_complete=false`, continúa la noche siguiente).
- Fases por dataset: carga histórica por `id` (reanudable) → eventos de la outbox (asignación exacta
  al lote, nunca `id > último`) → barrido `(write_date, id)` con solapamiento (120 min).
- NOVA recoge desde las 03:00 America/Guayaquil (configurable) solo lotes `ready`; el ACK llega
  después de persistir y validar todas las partes. Sin ACK nada se purga.
- `NOVA: retención` purga partes confirmadas con más de `retention_days` y eventos confirmados.
- Coordinar la ventana con backups, cierre de POS y otros crons del cliente: 00:00 no garantiza un
  servidor ocioso.

## Cola de trabajos en segundo plano (desde 16.0.1.1.0)

Cada lote se divide en **trabajos cortos** (`nova.sync.job`): uno por dataset al empezar y, si un
dataset no termina dentro de su tiempo, un trabajo de continuación (trozo 2, 3…). El cron ejecuta
**un solo trabajo por invocación**, confirma la transacción y vuelve a dispararse tras
`job_pause_seconds` (por defecto 10 s). Así el servidor respira entre trabajos y nunca hay un
proceso largo.

- Duración de cada trabajo: `time_budget_seconds` (por defecto 180 s), acotada al límite real del
  worker menos 30 s. Para trabajos de 3 min en modo multiproceso, configurar en `odoo.conf`
  `limit_time_real_cron = 240` (o `limit_time_real` si no se usa el de cron).
- Fallos: el trozo se revierte (savepoint), vuelve a la cola con espera de 1, 5 y 15 min, hasta
  `job_max_attempts` (3). Si sigue fallando, el dataset se marca con error en el manifest y
  el resto del lote continúa. "Reintentar fallidos" lo vuelve a encolar mientras el lote se prepara.
- Al cerrarse la ventana se publica lo preparado (parcial, marcado) y se cancelan los trabajos pendientes.

## Panel de control (NOVA → Panel de control)

- Lote actual: avance %, trabajos terminados, en cola y fallidos, registros exportados y duración
  media por trabajo.
- **Trabajos en segundo plano**: lista, tabla dinámica y gráfico por módulo/dataset/estado, con
  "Reintentar".
- **Verificar integridad** (local, acotado, no lee tablas de negocio):
  - huella de la base;
  - estado de la captura y resincronización;
  - datasets con campos obligatorios faltantes o con errores;
  - eventos atascados (más de 48 h) o sin dataset activo;
  - lotes atascados y trabajos fallidos;
  - cron activo;
  - **checksum sha256** de hasta 50 partes del último lote;
  - uso de la cuota.

## Recursos y cuotas

Si los bytes de partes sin ACK superan `max_pending_bytes`, la preparación se detiene y se registra
el error (el ERP sigue operando). Si la cola de eventos crece por encima de `max_pending_events` se
avisa en el manifest. "Desactivar captura (emergencia)" prioriza la continuidad del ERP y marca
**resincronización requerida** (se pierde la garantía de deltas hasta completar la recarga).

## Copias, restauraciones y clones

La huella de la base (nombre + `database.uuid` + fecha de creación) se verifica en cada cron y en
cada llamada RPC: si cambia, la conexión pasa a **Suspendida** y no publica lotes. `odoo-bin
neutralize` aplica `data/neutralize.sql` (suspende y cancela lotes). Procedimiento para un clon que
deba sincronizar: "Re-vincular tras copia/restauración" → nueva generación de fuente → vincular de
nuevo en NOVA. NOVA rechaza manifests de otra generación y **nunca borra datos centrales** por un
cambio de fuente.

## Límites conocidos (no se afirma cobertura universal)

- Hooks solo en `create`/`write`/`unlink` del ORM (`@api.model_create_multi`). No pasan por ellos:
  SQL directo, `ON DELETE CASCADE` (p. ej. líneas al borrar un pedido: NOVA aplica la cascada
  declarada en `children`), campos calculados almacenados recalculados vía `_write` (los recoge el
  barrido por `write_date`). La conciliación de conteos por compañía detecta diferencias y permite
  pedir `request_resync`.
- `requested_cutoff_at` (medianoche local) no es una fotografía consistente: el manifest declara
  `consistency: captured_interval` con `observed_from/observed_to` reales.

## Desinstalación

Desinstalar elimina solo tablas técnicas NOVA (conexión, datasets, lotes, partes y sus adjuntos,
cola, cursores). No toca documentos de negocio. Los hooks desaparecen con el código del addon.
Los datos ya recibidos en NOVA se conservan según la política central.
