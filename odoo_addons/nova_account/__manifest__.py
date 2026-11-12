{
    "name": "NOVA Accounting",
    "version": "16.0.1.2.0",
    "category": "Technical",
    "summary": "Facturas, notas de crédito, cartera y conciliaciones para NOVA",
    "author": "Nova Business",
    "license": "Other proprietary",
    "depends": ["nova_master_data", "account"],
    "data": ["security/ir.model.access.csv"],
    "post_init_hook": "post_init_hook",
    "installable": True,
    "auto_install": False,
    "application": False,
}
