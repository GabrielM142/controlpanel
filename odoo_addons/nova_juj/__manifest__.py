{
    "name": "NOVA JUJ Adapter",
    "version": "16.0.1.0.0",
    "category": "Technical",
    "summary": "Adaptador JUJ: mapeo de marca, unidad, zona, cantón y canal a campos personalizados",
    "description": """
Client adapter kept apart from the generic connector. It does not hardcode any
JUJ technical field name: an administrator maps each semantic attribute to a
real stored field of an exported dataset; the field is then exported as an
"extra" value and the mapping is published in get_capabilities().
""",
    "author": "Nova Business",
    "license": "Other proprietary",
    "depends": ["nova_master_data"],
    "data": [
        "security/ir.model.access.csv",
        "views/nova_juj_views.xml",
    ],
    "installable": True,
    "auto_install": False,
    "application": False,
}
