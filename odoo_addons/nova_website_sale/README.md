# NOVA Website Sale (`nova_website_sale`)

Canal web (eCommerce) para NOVA. Addon **opt-in** para Odoo 16 Community; depende de: `nova_sales`, `website_sale`.
Instálalo solo si el cliente vende por la tienda en línea de Odoo. No crea tablas de negocio
ni modifica documentos: declara datasets (`nova_spec.py`) y agrega captura de cambios.

## Datasets

| Clave | Modelo | Alcance compañía | Descripción |
|---|---|---|---|
| `website` | `website` | strict | Sitios web (tiendas en línea) |
| `website_sale_order` | `sale.order` (solo con `website_id`) | strict | Canal web de cada pedido, incluidos carritos en borrador |

El importe y las líneas siguen saliendo por `sale_order` / `sale_order_line` de `nova_sales`:
`website_sale_order` solo agrega el canal, así el central atribuye la venta a la tienda en línea
sin contarla dos veces. Los carritos (`state = draft`) sirven para medir abandono; no son venta.
