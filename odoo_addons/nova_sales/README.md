# NOVA Sales (`nova_sales`)

Pedidos y líneas de venta (no confundir con venta facturada). Addon **opt-in** de NOVA para Odoo 16 Community; depende de: `nova_master_data`, `sale_management`.
No crea tablas de negocio ni modifica documentos: solo declara datasets
(`nova_spec.py`) y agrega captura de cambios (`nova.capture.mixin`).

## Datasets

| Clave | Modelo | Alcance compañía | Descripción |
|---|---|---|---|
| `crm_team` | `crm.team` | shared | Equipos de venta |
| `sale_order` | `sale.order` | strict | Pedidos de venta (encabezado) |
| `sale_order_line` | `sale.order.line` | strict | Líneas de pedido: pedido/entregado/facturado separados |

Campos, tipos y sensibilidad: `nova_spec.py` y `contracts/datasets.json` del repositorio NOVA.
Campos marcados `opt` se exportan solo si existen en la instalación; los `pii` solo si un
administrador los habilita en el dataset.

## Dependencias de captura

- Ninguna.

## Relaciones padre/hijo

- `sale_order` → hijos `sale_order_line` por `order_id` (borrado en cascada aplicado en NOVA)

## Límites conocidos

- Solo se capturan `create`/`write`/`unlink` del ORM. SQL directo, `ON DELETE CASCADE` y campos
  calculados almacenados recalculados por `_write` no pasan por los hooks: los cubren el barrido
  `(write_date, id)` con solapamiento, la conciliación de conteos y la cascada declarada en NOVA.
- Instalar/actualizar: `odoo-bin -d <db> -i nova_sales` / `-u nova_sales`. Pruebas: `--test-enable --test-tags /nova_sales`.
