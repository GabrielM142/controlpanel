"""Valuation layers: separated so NOVA never claims a value where only quantities exist."""

DATASETS = [
    {"key": "stock_valuation_layer", "version": 1, "model": "stock.valuation.layer",
     "company_scope": "strict", "description": "Capas de valoración y ajustes de valor",
     "business_date": "create_date",
     "fields": {"product_id": "m2o", "company_id": "m2o", "quantity": "decimal",
                "unit_cost": "decimal,cost", "value": "decimal,cost", "remaining_qty": "decimal",
                "remaining_value": "decimal,cost", "stock_move_id": "m2o", "account_move_id": "m2o",
                "stock_valuation_layer_id": "m2o", "create_date": "datetime"},
     "capture": {"fields": None, "refs": ["company_id", "product_id"]}},
    {"key": "stock_ops_month", "version": 1, "model": "nova.stock.ops.month",
     "company_scope": "strict", "mode": "snapshot_replace",
     "description": "Operaciones de bodega por mes: ajustes de inventario y horas de preparación de despachos",
     "fields": {"company_id": "m2o", "kind": "string", "month": "date", "moves": "int", "products": "int",
                "value_net": "decimal", "value_abs": "decimal", "hours": "decimal"}},
]

DEPENDENCIES = []
