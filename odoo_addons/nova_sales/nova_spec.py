"""Datasets of nova_sales. Orders are NOT sales: invoiced revenue comes from nova_account."""

DATASETS = [
    {"key": "crm_team", "version": 1, "model": "crm.team", "company_scope": "shared",
     "description": "Equipos de venta",
     "fields": {"name": "string", "user_id": "m2o", "company_id": "m2o", "active": "bool"},
     "capture": {"fields": None, "refs": ["company_id"]}},
    {"key": "sale_order", "version": 1, "model": "sale.order", "company_scope": "strict",
     "description": "Pedidos de venta (encabezado)", "business_date": "date_order",
     "fields": {"name": "string", "partner_id": "m2o", "partner_invoice_id": "m2o",
                "partner_shipping_id": "m2o", "date_order": "datetime", "state": "selection",
                "user_id": "m2o", "team_id": "m2o", "company_id": "m2o", "currency_id": "m2o",
                "pricelist_id": "m2o", "amount_untaxed": "decimal,price", "amount_total": "decimal,price",
                "invoice_status": "selection", "commitment_date": "datetime",
                # sale_stock: 'full' once every delivery is done or cancelled, even if quantities
                # remain undelivered; that remainder will never ship and is not backorder.
                "delivery_status": "selection,opt"},
     "capture": {"fields": None, "refs": ["company_id", "partner_id", "user_id", "date_order"]},
     "children": [{"dataset": "sale_order_line", "fk": "order_id"}]},
    {"key": "sale_order_line", "version": 1, "model": "sale.order.line", "company_scope": "strict",
     "description": "Líneas de pedido: pedido/entregado/facturado separados",
     "fields": {"order_id": "m2o", "product_id": "m2o", "product_uom": "m2o",
                "product_uom_qty": "decimal", "qty_delivered": "decimal", "qty_invoiced": "decimal",
                "qty_to_invoice": "decimal", "price_unit": "decimal,price", "discount": "decimal",
                "price_subtotal": "decimal,price", "price_total": "decimal,price", "company_id": "m2o",
                "currency_id": "m2o", "state": "selection", "display_type": "selection",
                "salesman_id": "m2o", "order_partner_id": "m2o", "purchase_price": "decimal,cost,opt"},
     "capture": {"fields": None, "refs": ["order_id", "company_id", "product_id"]}},
]

DEPENDENCIES = []
