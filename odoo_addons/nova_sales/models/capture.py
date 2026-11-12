"""Change capture on the models exported by nova_sales (ORM create/write/unlink only)."""
from odoo import models


class CrmTeam(models.Model):
    _name = "crm.team"
    _inherit = ["crm.team", "nova.capture.mixin"]


class SaleOrder(models.Model):
    _name = "sale.order"
    _inherit = ["sale.order", "nova.capture.mixin"]


class SaleOrderLine(models.Model):
    _name = "sale.order.line"
    _inherit = ["sale.order.line", "nova.capture.mixin"]
