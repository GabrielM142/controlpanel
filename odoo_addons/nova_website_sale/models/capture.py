"""Change capture on the models exported by nova_website_sale (ORM create/write/unlink only).
sale.order already carries nova.capture.mixin through nova_sales."""
from odoo import models


class Website(models.Model):
    _name = "website"
    _inherit = ["website", "nova.capture.mixin"]
