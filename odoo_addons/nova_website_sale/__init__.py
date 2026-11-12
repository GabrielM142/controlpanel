from odoo.addons.nova_connector.nova_lib import registry

from . import models
from .nova_spec import DATASETS, DEPENDENCIES

registry.register("nova_website_sale", DATASETS, DEPENDENCIES)


def post_init_hook(cr, registry_):
    from odoo import api, SUPERUSER_ID

    env = api.Environment(cr, SUPERUSER_ID, {})
    env["nova.export.dataset"]._nova_sync_registry()
