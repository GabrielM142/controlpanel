"""Change capture on the models exported by nova_purchase (ORM create/write/unlink only)."""
from odoo import models


class PurchaseOrder(models.Model):
    _name = "purchase.order"
    _inherit = ["purchase.order", "nova.capture.mixin"]


class PurchaseOrderLine(models.Model):
    _name = "purchase.order.line"
    _inherit = ["purchase.order.line", "nova.capture.mixin"]
