"""Change capture on the models exported by nova_stock (ORM create/write/unlink only)."""
from odoo import models


class StockWarehouse(models.Model):
    _name = "stock.warehouse"
    _inherit = ["stock.warehouse", "nova.capture.mixin"]


class StockLocation(models.Model):
    _name = "stock.location"
    _inherit = ["stock.location", "nova.capture.mixin"]


class StockPickingType(models.Model):
    _name = "stock.picking.type"
    _inherit = ["stock.picking.type", "nova.capture.mixin"]


class StockPicking(models.Model):
    _name = "stock.picking"
    _inherit = ["stock.picking", "nova.capture.mixin"]


class StockMove(models.Model):
    _name = "stock.move"
    _inherit = ["stock.move", "nova.capture.mixin"]


class StockQuant(models.Model):
    _name = "stock.quant"
    _inherit = ["stock.quant", "nova.capture.mixin"]
