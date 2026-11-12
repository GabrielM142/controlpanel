"""Change capture on the models exported by nova_pos (ORM create/write/unlink only)."""
from odoo import models


class PosConfig(models.Model):
    _name = "pos.config"
    _inherit = ["pos.config", "nova.capture.mixin"]


class PosSession(models.Model):
    _name = "pos.session"
    _inherit = ["pos.session", "nova.capture.mixin"]


class PosOrder(models.Model):
    _name = "pos.order"
    _inherit = ["pos.order", "nova.capture.mixin"]


class PosOrderLine(models.Model):
    _name = "pos.order.line"
    _inherit = ["pos.order.line", "nova.capture.mixin"]
