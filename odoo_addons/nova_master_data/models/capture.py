"""Change capture on the models exported by nova_master_data (ORM create/write/unlink only)."""
from odoo import models


class ResCompany(models.Model):
    _name = "res.company"
    _inherit = ["res.company", "nova.capture.mixin"]


class ResPartner(models.Model):
    _name = "res.partner"
    _inherit = ["res.partner", "nova.capture.mixin"]


class ResCountryState(models.Model):
    _name = "res.country.state"
    _inherit = ["res.country.state", "nova.capture.mixin"]


class ResUsers(models.Model):
    _name = "res.users"
    _inherit = ["res.users", "nova.capture.mixin"]


class ProductCategory(models.Model):
    _name = "product.category"
    _inherit = ["product.category", "nova.capture.mixin"]


class ProductTemplate(models.Model):
    _name = "product.template"
    _inherit = ["product.template", "nova.capture.mixin"]


class ProductProduct(models.Model):
    _name = "product.product"
    _inherit = ["product.product", "nova.capture.mixin"]


class UomUom(models.Model):
    _name = "uom.uom"
    _inherit = ["uom.uom", "nova.capture.mixin"]


class ResCurrency(models.Model):
    _name = "res.currency"
    _inherit = ["res.currency", "nova.capture.mixin"]


class ResCurrencyRate(models.Model):
    _name = "res.currency.rate"
    _inherit = ["res.currency.rate", "nova.capture.mixin"]
