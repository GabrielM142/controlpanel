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


class ResPartner(models.Model):
    _inherit = "res.partner"

    def _increase_rank(self, field, n=1):
        # The account module bumps customer_rank/supplier_rank with raw SQL (no write,
        # no write_date): without this event the partner would keep rank 0 in NOVA.
        # Defined here (not in nova_master_data) because _increase_rank belongs to
        # account: an override in a module loaded before account would be shadowed.
        res = super()._increase_rank(field, n)
        if self.ids and field in ("customer_rank", "supplier_rank"):
            self.env["nova.change.event"]._nova_record(self, "upsert", dataset_keys=["res_partner"])
        return res
