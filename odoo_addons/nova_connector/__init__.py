import logging

from . import models

_logger = logging.getLogger(__name__)


def post_init_hook(cr, registry):
    """Odoo 16 signature. Creates the (unlinked) connection and syncs datasets."""
    from odoo import api, SUPERUSER_ID

    env = api.Environment(cr, SUPERUSER_ID, {})
    env["nova.connection"]._nova_ensure_connection()
    env["nova.export.dataset"]._nova_sync_registry()


def uninstall_hook(cr, registry):
    """Business documents are never touched. Technical artifacts (runs, parts,
    attachments, events) are removed with the module tables; we only log it."""
    _logger.info("NOVA connector uninstalled: technical NOVA tables dropped, ERP data untouched")
