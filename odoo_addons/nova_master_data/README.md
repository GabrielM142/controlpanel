# NOVA Master Data (`nova_master_data`)

Clientes, productos, categorías, UoM, monedas y compañías para NOVA. Addon **opt-in** de NOVA para Odoo 16 Community; depende de: `nova_connector`, `product`.
No crea tablas de negocio ni modifica documentos: solo declara datasets
(`nova_spec.py`) y agrega captura de cambios (`nova.capture.mixin`).

## Datasets

| Clave | Modelo | Alcance compañía | Descripción |
|---|---|---|---|
| `res_company` | `res.company` | self | Compañías autorizadas |
| `res_partner` | `res.partner` | shared | Clientes, proveedores y contactos comerciales |
| `res_country_state` | `res.country.state` | none | Provincias / estados |
| `res_users` | `res.users` | none | Usuarios (vendedores/responsables): solo nombre y estado |
| `product_category` | `product.category` | none | Categorías de producto |
| `product_template` | `product.template` | shared | Plantillas de producto |
| `product_product` | `product.product` | shared | Variantes de producto |
| `uom_uom` | `uom.uom` | none | Unidades de medida |
| `res_currency` | `res.currency` | none | Monedas |
| `res_currency_rate` | `res.currency.rate` | shared | Tipos de cambio |

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
- Instalar/actualizar: `odoo-bin -d <db> -i nova_master_data` / `-u nova_master_data`. Pruebas: `--test-enable --test-tags /nova_master_data`.
