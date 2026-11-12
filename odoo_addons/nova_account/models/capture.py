"""Change capture on the models exported by nova_account (ORM create/write/unlink only)."""
from odoo import models


class AccountAccount(models.Model):
    _name = "account.account"
    _inherit = ["account.account", "nova.capture.mixin"]


class AccountJournal(models.Model):
    _name = "account.journal"
    _inherit = ["account.journal", "nova.capture.mixin"]


class AccountMove(models.Model):
    _name = "account.move"
    _inherit = ["account.move", "nova.capture.mixin"]


class AccountMoveLine(models.Model):
    _name = "account.move.line"
    _inherit = ["account.move.line", "nova.capture.mixin"]


class AccountPartialReconcile(models.Model):
    _name = "account.partial.reconcile"
    _inherit = ["account.partial.reconcile", "nova.capture.mixin"]
