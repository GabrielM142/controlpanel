"""Purchases: received/invoiced quantities kept separate (no amount duplication on partials)."""

DATASETS = [
    {"key": "purchase_order", "version": 1, "model": "purchase.order", "company_scope": "strict",
     "description": "Órdenes de compra", "business_date": "date_approve",
     "fields": {"name": "string", "partner_id": "m2o", "date_order": "datetime",
                "date_approve": "datetime", "date_planned": "datetime", "state": "selection",
                "user_id": "m2o", "company_id": "m2o", "currency_id": "m2o",
                "amount_untaxed": "decimal,cost", "amount_total": "decimal,cost",
                "invoice_status": "selection", "receipt_status": "selection,opt",
                "picking_type_id": "m2o",
                # purchase_stock: date of the first receipt (supplier lead time).
                "effective_date": "datetime,opt"},
     "capture": {"fields": None, "refs": ["company_id", "partner_id"]},
     "children": [{"dataset": "purchase_order_line", "fk": "order_id"}]},
    {"key": "purchase_order_line", "version": 1, "model": "purchase.order.line", "company_scope": "strict",
     "description": "Líneas de compra con fecha prevista y cantidades recibidas",
     "fields": {"order_id": "m2o", "product_id": "m2o", "product_qty": "decimal", "product_uom": "m2o",
                "qty_received": "decimal", "qty_invoiced": "decimal", "price_unit": "decimal,cost",
                "price_subtotal": "decimal,cost", "date_planned": "datetime", "company_id": "m2o",
                "state": "selection", "currency_id": "m2o", "partner_id": "m2o",
                "display_type": "selection"},
     "capture": {"fields": None, "refs": ["order_id", "company_id", "product_id"]}},
]

DEPENDENCIES = []
