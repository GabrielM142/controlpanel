# NOVA Point of Sale (`nova_pos`)

Pedidos, líneas y sesiones POS con vínculo contable para NOVA. Addon **opt-in** de NOVA para Odoo 16 Community; depende de: `nova_account`, `point_of_sale`.
No crea tablas de negocio ni modifica documentos: solo declara datasets
(`nova_spec.py`) y agrega captura de cambios (`nova.capture.mixin`).

## Datasets

| Clave | Modelo | Alcance compañía | Descripción |
|---|---|---|---|
| `pos_config` | `pos.config` | strict | Puntos de venta |
| `pos_session` | `pos.session` | none | Sesiones POS |
| `pos_order` | `pos.order` | strict | Pedidos POS |
| `pos_order_line` | `pos.order.line` | strict | Líneas POS (devoluciones con cantidad negativa) |

Campos, tipos y sensibilidad: `nova_spec.py` y `contracts/datasets.json` del repositorio NOVA.
Campos marcados `opt` se exportan solo si existen en la instalación; los `pii` solo si un
administrador los habilita en el dataset.

## Dependencias de captura

- Ninguna.

## Relaciones padre/hijo

- `pos_order` → hijos `pos_order_line` por `order_id` (borrado en cascada aplicado en NOVA)

## Límites conocidos

- Solo se capturan `create`/`write`/`unlink` del ORM. SQL directo, `ON DELETE CASCADE` y campos
  calculados almacenados recalculados por `_write` no pasan por los hooks: los cubren el barrido
  `(write_date, id)` con solapamiento, la conciliación de conteos y la cascada declarada en NOVA.
- Instalar/actualizar: `odoo-bin -d <db> -i nova_pos` / `-u nova_pos`. Pruebas: `--test-enable --test-tags /nova_pos`.
