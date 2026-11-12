# NOVA Accounting (`nova_account`)

Facturas, notas de crédito, cartera y conciliaciones para NOVA. Addon **opt-in** de NOVA para Odoo 16 Community; depende de: `nova_master_data`, `account`.
No crea tablas de negocio ni modifica documentos: solo declara datasets
(`nova_spec.py`) y agrega captura de cambios (`nova.capture.mixin`).

## Datasets

| Clave | Modelo | Alcance compañía | Descripción |
|---|---|---|---|
| `account_account` | `account.account` | strict | Plan de cuentas |
| `account_journal` | `account.journal` | strict | Diarios |
| `account_move` | `account.move` | strict | Asientos/facturas (encabezado) |
| `account_move_line` | `account.move.line` | strict | Apuntes: líneas de factura, impuestos, costo (cogs) y cartera |
| `account_partial_reconcile` | `account.partial.reconcile` | strict | Conciliaciones parciales (pagos aplicados) |

Campos, tipos y sensibilidad: `nova_spec.py` y `contracts/datasets.json` del repositorio NOVA.
Campos marcados `opt` se exportan solo si existen en la instalación; los `pii` solo si un
administrador los habilita en el dataset.

## Dependencias de captura

- `account.partial.reconcile` (debit_move_id, credit_move_id) encola también `account_move_line`: Pago/conciliación actualiza cartera

## Relaciones padre/hijo

- `account_move` → hijos `account_move_line` por `move_id` (borrado en cascada aplicado en NOVA)

## Límites conocidos

- Solo se capturan `create`/`write`/`unlink` del ORM. SQL directo, `ON DELETE CASCADE` y campos
  calculados almacenados recalculados por `_write` no pasan por los hooks: los cubren el barrido
  `(write_date, id)` con solapamiento, la conciliación de conteos y la cascada declarada en NOVA.
- Instalar/actualizar: `odoo-bin -d <db> -i nova_account` / `-u nova_account`. Pruebas: `--test-enable --test-tags /nova_account`.
