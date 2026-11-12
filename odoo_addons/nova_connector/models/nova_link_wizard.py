from odoo import fields, models


class NovaLinkWizard(models.TransientModel):
    """Shows the one-time pairing code once. Only its hash is stored on the
    connection; the transient record is vacuumed automatically."""

    _name = "nova.link.wizard"
    _description = "NOVA pairing code"

    connection_id = fields.Many2one("nova.connection", required=True, readonly=True)
    token = fields.Char(readonly=True)
    installation_uuid = fields.Char(related="connection_id.installation_uuid")
    expires_at = fields.Datetime(related="connection_id.link_token_expires_at")
