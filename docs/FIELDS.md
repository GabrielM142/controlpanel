# Inventario de campos exportados (contrato nova.export.v1)

Generado por `python odoo_addons/tools/gen_contracts.py` desde los `nova_spec.py` de los addons.
`id` y `write_date` son implícitos. **opt**: solo si existe en la instalación. **pii**: excluido salvo
habilitación explícita por un administrador. **cost/price**: dato sensible exportado y etiquetado.
Nunca se exportan contraseñas, tokens, binarios, adjuntos ni mensajes/chatter.

## `res_company` v1 · `res.company` (nova_master_data)

Compañías autorizadas. Alcance compañía: `self`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `currency_id` | m2o |  |  |
| `partner_id` | m2o |  |  |
| `parent_id` | m2o |  |  |
| `country_id` | m2o |  |  |

## `res_partner` v1 · `res.partner` (nova_master_data)

Clientes, proveedores y contactos comerciales. Alcance compañía: `shared`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `is_company` | bool |  |  |
| `parent_id` | m2o |  |  |
| `commercial_partner_id` | m2o |  |  |
| `company_id` | m2o |  |  |
| `state_id` | m2o |  |  |
| `country_id` | m2o |  |  |
| `city` | string |  |  |
| `zip` | string |  |  |
| `ref` | string | sí |  |
| `vat` | string |  | pii |
| `email` | string |  | pii |
| `phone` | string |  | pii |
| `customer_rank` | int | sí |  |
| `supplier_rank` | int | sí |  |
| `user_id` | m2o |  |  |
| `industry_id` | m2o |  |  |
| `category_id` | m2m |  |  |
| `active` | bool |  |  |

## `res_country_state` v1 · `res.country.state` (nova_master_data)

Provincias / estados. Alcance compañía: `none`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `code` | string |  |  |
| `country_id` | m2o |  |  |

## `res_users` v1 · `res.users` (nova_master_data)

Usuarios (vendedores/responsables): solo nombre y estado. Alcance compañía: `none`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `active` | bool |  |  |
| `company_id` | m2o |  |  |
| `partner_id` | m2o |  |  |

## `product_category` v1 · `product.category` (nova_master_data)

Categorías de producto. Alcance compañía: `none`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `complete_name` | string |  |  |
| `parent_id` | m2o |  |  |

## `product_template` v1 · `product.template` (nova_master_data)

Plantillas de producto. Alcance compañía: `shared`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `default_code` | string |  |  |
| `categ_id` | m2o |  |  |
| `type` | selection |  |  |
| `detailed_type` | selection | sí |  |
| `uom_id` | m2o |  |  |
| `uom_po_id` | m2o |  |  |
| `sale_ok` | bool |  |  |
| `purchase_ok` | bool |  |  |
| `active` | bool |  |  |
| `company_id` | m2o |  |  |
| `list_price` | decimal |  | price |

## `product_product` v1 · `product.product` (nova_master_data)

Variantes de producto. Alcance compañía: `shared`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `product_tmpl_id` | m2o |  |  |
| `default_code` | string |  |  |
| `barcode` | string | sí |  |
| `active` | bool |  |  |
| `company_id` | m2o |  |  |

## `uom_uom` v1 · `uom.uom` (nova_master_data)

Unidades de medida. Alcance compañía: `none`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `category_id` | m2o |  |  |
| `factor` | decimal |  |  |
| `uom_type` | selection |  |  |
| `rounding` | decimal |  |  |
| `active` | bool |  |  |

## `res_currency` v1 · `res.currency` (nova_master_data)

Monedas. Alcance compañía: `none`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `symbol` | string |  |  |
| `decimal_places` | int |  |  |
| `rounding` | decimal |  |  |
| `active` | bool |  |  |

## `res_currency_rate` v1 · `res.currency.rate` (nova_master_data)

Tipos de cambio. Alcance compañía: `shared`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | date |  |  |
| `rate` | decimal |  |  |
| `currency_id` | m2o |  |  |
| `company_id` | m2o |  |  |

## `crm_team` v1 · `crm.team` (nova_sales)

Equipos de venta. Alcance compañía: `shared`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `user_id` | m2o |  |  |
| `company_id` | m2o |  |  |
| `active` | bool |  |  |

## `sale_order` v1 · `sale.order` (nova_sales)

Pedidos de venta (encabezado). Alcance compañía: `strict`. Modo: `delta`. Hijos: `sale_order_line` por `order_id`

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `partner_id` | m2o |  |  |
| `partner_invoice_id` | m2o |  |  |
| `partner_shipping_id` | m2o |  |  |
| `date_order` | datetime |  |  |
| `state` | selection |  |  |
| `user_id` | m2o |  |  |
| `team_id` | m2o |  |  |
| `company_id` | m2o |  |  |
| `currency_id` | m2o |  |  |
| `pricelist_id` | m2o |  |  |
| `amount_untaxed` | decimal |  | price |
| `amount_total` | decimal |  | price |
| `invoice_status` | selection |  |  |
| `commitment_date` | datetime |  |  |

## `sale_order_line` v1 · `sale.order.line` (nova_sales)

Líneas de pedido: pedido/entregado/facturado separados. Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `order_id` | m2o |  |  |
| `product_id` | m2o |  |  |
| `product_uom` | m2o |  |  |
| `product_uom_qty` | decimal |  |  |
| `qty_delivered` | decimal |  |  |
| `qty_invoiced` | decimal |  |  |
| `qty_to_invoice` | decimal |  |  |
| `price_unit` | decimal |  | price |
| `discount` | decimal |  |  |
| `price_subtotal` | decimal |  | price |
| `price_total` | decimal |  | price |
| `company_id` | m2o |  |  |
| `currency_id` | m2o |  |  |
| `state` | selection |  |  |
| `display_type` | selection |  |  |
| `salesman_id` | m2o |  |  |
| `order_partner_id` | m2o |  |  |
| `purchase_price` | decimal | sí | cost |

## `account_account` v1 · `account.account` (nova_account)

Plan de cuentas. Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `code` | string |  |  |
| `name` | string |  |  |
| `account_type` | selection |  |  |
| `company_id` | m2o |  |  |
| `deprecated` | bool |  |  |
| `reconcile` | bool |  |  |

## `account_journal` v1 · `account.journal` (nova_account)

Diarios. Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `code` | string |  |  |
| `type` | selection |  |  |
| `company_id` | m2o |  |  |
| `active` | bool |  |  |

## `account_move` v1 · `account.move` (nova_account)

Asientos/facturas (encabezado). Alcance compañía: `strict`. Modo: `delta`. Hijos: `account_move_line` por `move_id`

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `move_type` | selection |  |  |
| `state` | selection |  |  |
| `date` | date |  |  |
| `invoice_date` | date |  |  |
| `invoice_date_due` | date |  |  |
| `partner_id` | m2o |  |  |
| `commercial_partner_id` | m2o |  |  |
| `invoice_user_id` | m2o |  |  |
| `journal_id` | m2o |  |  |
| `company_id` | m2o |  |  |
| `currency_id` | m2o |  |  |
| `amount_untaxed_signed` | decimal |  |  |
| `amount_total_signed` | decimal |  |  |
| `amount_residual_signed` | decimal |  |  |
| `payment_state` | selection |  |  |
| `reversed_entry_id` | m2o |  |  |
| `invoice_origin` | string |  |  |
| `team_id` | m2o | sí |  |

## `account_move_line` v1 · `account.move.line` (nova_account)

Apuntes: líneas de factura, impuestos, costo (cogs) y cartera. Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `move_id` | m2o |  |  |
| `account_id` | m2o |  |  |
| `partner_id` | m2o |  |  |
| `product_id` | m2o |  |  |
| `product_uom_id` | m2o |  |  |
| `quantity` | decimal |  |  |
| `price_unit` | decimal |  | price |
| `discount` | decimal |  |  |
| `price_subtotal` | decimal |  | price |
| `price_total` | decimal |  | price |
| `balance` | decimal |  |  |
| `debit` | decimal |  |  |
| `credit` | decimal |  |  |
| `amount_currency` | decimal |  |  |
| `currency_id` | m2o |  |  |
| `company_id` | m2o |  |  |
| `date` | date |  |  |
| `date_maturity` | date |  |  |
| `display_type` | selection |  |  |
| `amount_residual` | decimal |  |  |
| `amount_residual_currency` | decimal |  |  |
| `reconciled` | bool |  |  |
| `full_reconcile_id` | m2o |  |  |
| `parent_state` | selection |  |  |
| `journal_id` | m2o |  |  |
| `sale_line_ids` | m2m | sí |  |

## `account_partial_reconcile` v1 · `account.partial.reconcile` (nova_account)

Conciliaciones parciales (pagos aplicados). Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `debit_move_id` | m2o |  |  |
| `credit_move_id` | m2o |  |  |
| `amount` | decimal |  |  |
| `debit_amount_currency` | decimal |  |  |
| `credit_amount_currency` | decimal |  |  |
| `max_date` | date |  |  |
| `company_id` | m2o |  |  |
| `full_reconcile_id` | m2o |  |  |

## `stock_warehouse` v1 · `stock.warehouse` (nova_stock)

Bodegas. Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `code` | string |  |  |
| `company_id` | m2o |  |  |
| `lot_stock_id` | m2o |  |  |
| `view_location_id` | m2o |  |  |
| `active` | bool |  |  |

## `stock_location` v1 · `stock.location` (nova_stock)

Ubicaciones. Alcance compañía: `shared`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `complete_name` | string |  |  |
| `usage` | selection |  |  |
| `location_id` | m2o |  |  |
| `warehouse_id` | m2o |  |  |
| `company_id` | m2o |  |  |
| `active` | bool |  |  |

## `stock_picking_type` v1 · `stock.picking.type` (nova_stock)

Tipos de operación. Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `code` | selection |  |  |
| `warehouse_id` | m2o |  |  |
| `company_id` | m2o |  |  |
| `active` | bool |  |  |

## `stock_picking` v1 · `stock.picking` (nova_stock)

Transferencias (despachos/recepciones). Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `picking_type_id` | m2o |  |  |
| `partner_id` | m2o |  |  |
| `scheduled_date` | datetime |  |  |
| `date_deadline` | datetime |  |  |
| `date_done` | datetime |  |  |
| `state` | selection |  |  |
| `origin` | string |  |  |
| `company_id` | m2o |  |  |
| `location_id` | m2o |  |  |
| `location_dest_id` | m2o |  |  |
| `backorder_id` | m2o |  |  |
| `user_id` | m2o |  |  |

## `stock_move` v1 · `stock.move` (nova_stock)

Movimientos de stock. Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `product_id` | m2o |  |  |
| `product_uom_qty` | decimal |  |  |
| `product_qty` | decimal |  |  |
| `quantity_done` | decimal |  |  |
| `product_uom` | m2o |  |  |
| `location_id` | m2o |  |  |
| `location_dest_id` | m2o |  |  |
| `state` | selection |  |  |
| `date` | datetime |  |  |
| `date_deadline` | datetime |  |  |
| `company_id` | m2o |  |  |
| `picking_id` | m2o |  |  |
| `picking_type_id` | m2o |  |  |
| `origin_returned_move_id` | m2o |  |  |
| `warehouse_id` | m2o |  |  |
| `reference` | string |  |  |
| `price_unit` | decimal |  | cost |
| `sale_line_id` | m2o | sí |  |
| `purchase_line_id` | m2o | sí |  |

## `stock_quant` v1 · `stock.quant` (nova_stock)

Existencias por ubicación (estado actual). Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `product_id` | m2o |  |  |
| `location_id` | m2o |  |  |
| `lot_id` | m2o |  |  |
| `quantity` | decimal |  |  |
| `reserved_quantity` | decimal |  |  |
| `company_id` | m2o |  |  |
| `in_date` | datetime |  |  |

## `stock_valuation_layer` v1 · `stock.valuation.layer` (nova_stock_account)

Capas de valoración y ajustes de valor. Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `product_id` | m2o |  |  |
| `company_id` | m2o |  |  |
| `quantity` | decimal |  |  |
| `unit_cost` | decimal |  | cost |
| `value` | decimal |  | cost |
| `remaining_qty` | decimal |  |  |
| `remaining_value` | decimal |  | cost |
| `stock_move_id` | m2o |  |  |
| `account_move_id` | m2o |  |  |
| `stock_valuation_layer_id` | m2o |  |  |
| `create_date` | datetime |  |  |

## `purchase_order` v1 · `purchase.order` (nova_purchase)

Órdenes de compra. Alcance compañía: `strict`. Modo: `delta`. Hijos: `purchase_order_line` por `order_id`

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `partner_id` | m2o |  |  |
| `date_order` | datetime |  |  |
| `date_approve` | datetime |  |  |
| `date_planned` | datetime |  |  |
| `state` | selection |  |  |
| `user_id` | m2o |  |  |
| `company_id` | m2o |  |  |
| `currency_id` | m2o |  |  |
| `amount_untaxed` | decimal |  | cost |
| `amount_total` | decimal |  | cost |
| `invoice_status` | selection |  |  |
| `receipt_status` | selection | sí |  |
| `picking_type_id` | m2o |  |  |

## `purchase_order_line` v1 · `purchase.order.line` (nova_purchase)

Líneas de compra con fecha prevista y cantidades recibidas. Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `order_id` | m2o |  |  |
| `product_id` | m2o |  |  |
| `product_qty` | decimal |  |  |
| `product_uom` | m2o |  |  |
| `qty_received` | decimal |  |  |
| `qty_invoiced` | decimal |  |  |
| `price_unit` | decimal |  | cost |
| `price_subtotal` | decimal |  | cost |
| `date_planned` | datetime |  |  |
| `company_id` | m2o |  |  |
| `state` | selection |  |  |
| `currency_id` | m2o |  |  |
| `partner_id` | m2o |  |  |
| `display_type` | selection |  |  |

## `pos_config` v1 · `pos.config` (nova_pos)

Puntos de venta. Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `company_id` | m2o |  |  |
| `active` | bool |  |  |
| `journal_id` | m2o |  |  |
| `picking_type_id` | m2o |  |  |

## `pos_session` v1 · `pos.session` (nova_pos)

Sesiones POS. Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `config_id` | m2o |  |  |
| `user_id` | m2o |  |  |
| `start_at` | datetime |  |  |
| `stop_at` | datetime |  |  |
| `state` | selection |  |  |
| `move_id` | m2o | sí |  |

## `pos_order` v1 · `pos.order` (nova_pos)

Pedidos POS. Alcance compañía: `strict`. Modo: `delta`. Hijos: `pos_order_line` por `order_id`

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `session_id` | m2o |  |  |
| `config_id` | m2o |  |  |
| `date_order` | datetime |  |  |
| `partner_id` | m2o |  |  |
| `user_id` | m2o |  |  |
| `company_id` | m2o |  |  |
| `state` | selection |  |  |
| `amount_total` | decimal |  | price |
| `amount_tax` | decimal |  |  |
| `amount_paid` | decimal |  |  |
| `amount_return` | decimal |  |  |
| `account_move` | m2o |  |  |
| `pricelist_id` | m2o |  |  |
| `currency_id` | m2o |  |  |

## `pos_order_line` v1 · `pos.order.line` (nova_pos)

Líneas POS (devoluciones con cantidad negativa). Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `order_id` | m2o |  |  |
| `product_id` | m2o |  |  |
| `qty` | decimal |  |  |
| `price_unit` | decimal |  | price |
| `discount` | decimal |  |  |
| `price_subtotal` | decimal |  | price |
| `price_subtotal_incl` | decimal |  | price |
| `total_cost` | decimal | sí | cost |
| `is_total_cost_computed` | bool | sí |  |
| `refunded_orderline_id` | m2o | sí |  |
| `company_id` | m2o |  |  |
| `full_product_name` | string |  |  |

## `website` v1 · `website` (nova_website_sale)

Sitios web (tiendas en línea). Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `name` | string |  |  |
| `company_id` | m2o |  |  |
| `domain` | string | sí |  |

## `website_sale_order` v1 · `sale.order` (nova_website_sale)

Canal web de los pedidos (incluye carritos en borrador). Alcance compañía: `strict`. Modo: `delta`.

| Campo | Tipo | Opcional | Sensibilidad |
|---|---|---|---|
| `website_id` | m2o |  |  |
| `company_id` | m2o |  |  |
| `state` | selection |  |  |
| `date_order` | datetime |  |  |

## Dependencias de captura

- `account.partial.reconcile` (debit_move_id, credit_move_id) → `account_move_line`: Pago/conciliación actualiza cartera
