"""POS datasets. Invoiced orders (state invoiced / account_move set) are
deduplicated centrally against the invoice and never counted twice."""

DATASETS = [
    {"key": "pos_config", "version": 1, "model": "pos.config", "company_scope": "strict",
     "description": "Puntos de venta",
     "fields": {"name": "string", "company_id": "m2o", "active": "bool", "journal_id": "m2o",
                "picking_type_id": "m2o"},
     "capture": {"fields": None, "refs": ["company_id"]}},
    {"key": "pos_session", "version": 1, "model": "pos.session", "company_scope": "strict",
     "description": "Sesiones POS",
     "fields": {"name": "string", "config_id": "m2o", "user_id": "m2o", "start_at": "datetime",
                "stop_at": "datetime", "state": "selection", "move_id": "m2o,opt"},
     "capture": {"fields": None, "refs": ["config_id"]}},
    {"key": "pos_order", "version": 1, "model": "pos.order", "company_scope": "strict",
     "description": "Pedidos POS", "business_date": "date_order",
     "fields": {"name": "string", "session_id": "m2o", "config_id": "m2o", "date_order": "datetime",
                "partner_id": "m2o", "user_id": "m2o", "company_id": "m2o", "state": "selection",
                "amount_total": "decimal,price", "amount_tax": "decimal", "amount_paid": "decimal",
                "amount_return": "decimal", "account_move": "m2o", "pricelist_id": "m2o",
                "currency_id": "m2o"},
     "capture": {"fields": None, "refs": ["company_id", "session_id", "date_order"]},
     "children": [{"dataset": "pos_order_line", "fk": "order_id"}]},
    {"key": "pos_order_line", "version": 1, "model": "pos.order.line", "company_scope": "strict",
     "description": "Líneas POS (devoluciones con cantidad negativa)",
     "fields": {"order_id": "m2o", "product_id": "m2o", "qty": "decimal", "price_unit": "decimal,price",
                "discount": "decimal", "price_subtotal": "decimal,price",
                "price_subtotal_incl": "decimal,price", "total_cost": "decimal,cost,opt", "is_total_cost_computed": "bool,opt",
                "refunded_orderline_id": "m2o,opt", "company_id": "m2o", "full_product_name": "string"},
     "capture": {"fields": None, "refs": ["order_id", "company_id", "product_id"]}},
]

DEPENDENCIES = []
