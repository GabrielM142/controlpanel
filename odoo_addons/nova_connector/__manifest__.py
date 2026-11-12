{
    "name": "NOVA Connector",
    "version": "16.0.1.1.0",
    "category": "Technical",
    "summary": "Night batch export of authorized Odoo data to NOVA (core, outbox, runs, ACK)",
    "description": """
NOVA Connector
==============
Core of the NOVA <-> Odoo 16 integration: connection/pairing, registry of
datasets declared in code, transactional change outbox, immutable night
batches split in bounded parts, cursors, ACK and retention. Functional data
is provided by the opt-in addons nova_master_data, nova_sales, nova_account,
nova_stock, nova_stock_account, nova_purchase and nova_pos.
""",
    "author": "Nova Business",
    "license": "Other proprietary",
    "depends": ["base"],
    "data": [
        "security/nova_security.xml",
        "security/ir.model.access.csv",
        "data/ir_cron.xml",
        "views/nova_connection_views.xml",
        "views/nova_dataset_views.xml",
        "views/nova_sync_views.xml",
        "views/nova_job_views.xml",
        "views/nova_link_wizard_views.xml",
        "views/nova_menus.xml",
    ],
    "post_init_hook": "post_init_hook",
    "uninstall_hook": "uninstall_hook",
    "installable": True,
    "auto_install": False,
    "application": False,
}
