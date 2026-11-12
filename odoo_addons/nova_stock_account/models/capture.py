"""Change capture on the models exported by nova_stock_account (ORM create/write/unlink only)."""
from odoo import models


class StockValuationLayer(models.Model):
    _name = "stock.valuation.layer"
    _inherit = ["stock.valuation.layer", "nova.capture.mixin"]
