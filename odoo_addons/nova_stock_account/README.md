# NOVA Stock Valuation (`nova_stock_account`)

Capas de valoración de inventario para NOVA. Addon **opt-in** de NOVA para Odoo 16 Community; depende de: `nova_stock`, `nova_account`, `stock_account`.
No crea tablas de negocio ni modifica documentos: solo declara datasets
(`nova_spec.py`) y agrega captura de cambios (`nova.capture.mixin`).

## Datasets

| Clave | Modelo | Alcance compañía | Descripción |
|---|---|---|---|
| `stock_valuation_layer` | `stock.valuation.layer` | strict | Capas de valoración y ajustes de valor |

Campos, tipos y sensibilidad: `nova_spec.py` y `contracts/datasets.json` del repositorio NOVA.
Campos marcados `opt` se exportan solo si existen en la instalación; los `pii` solo si un
administrador los habilita en el dataset.

## Dependencias de captura

- Ninguna.

## Relaciones padre/hijo

- Ninguno.

## Límites conocidos

- Solo se capturan `create`/`write`/`unlink` del ORM. SQL directo, `ON DELETE CASCADE` y campos
  calculados almacenados recalculados por `_write` no pasan por los hooks: los cubren el barrido
  `(write_date, id)` con solapamiento, la conciliación de conteos y la cascada declarada en NOVA.
- Instalar/actualizar: `odoo-bin -d <db> -i nova_stock_account` / `-u nova_stock_account`. Pruebas: `--test-enable --test-tags /nova_stock_account`.
