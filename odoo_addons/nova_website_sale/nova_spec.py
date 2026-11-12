"""eCommerce datasets (Odoo 16 Community `website_sale`). Only orders that come
from a website are exported here; the order itself (amounts, lines) is the
`sale_order` dataset of nova_sales: this dataset only adds the web channel, so
the central side can attribute sales to the online store without double counting."""

DATASETS = [
    {"key": "website", "version": 1, "model": "website", "company_scope": "strict",
     "description": "Sitios web (tiendas en línea)",
     "fields": {"name": "string", "company_id": "m2o", "domain": "string,opt"},
     "capture": {"fields": None, "refs": ["company_id"]}},
    {"key": "website_sale_order", "version": 1, "model": "sale.order", "company_scope": "strict",
     "description": "Canal web de los pedidos (incluye carritos en borrador)",
     "business_date": "date_order",
     "domain": [["website_id", "!=", False]],
     "fields": {"website_id": "m2o", "company_id": "m2o", "state": "selection", "date_order": "datetime"},
     "capture": {"fields": ["website_id", "state", "company_id", "date_order"],
                 "refs": ["company_id", "website_id"]}},
]

DEPENDENCIES = []
