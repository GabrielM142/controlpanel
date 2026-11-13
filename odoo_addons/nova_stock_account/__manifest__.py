{
    "name": "NOVA Stock Valuation",
    "version": "16.0.1.2.0",
    "category": "Technical",
    "summary": "Capas de valoración de inventario para NOVA",
    "author": "Nova Business",
    "license": "Other proprietary",
    "depends": ["nova_stock", "nova_account", "stock_account"],
    "data": ["security/ir.model.access.csv"],
    "post_init_hook": "post_init_hook",
    "installable": True,
    "auto_install": False,
    "application": False,
}
