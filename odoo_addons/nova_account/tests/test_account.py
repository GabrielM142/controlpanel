from odoo import fields
from odoo.tests import tagged

from odoo.addons.nova_connector.tests.functional import NovaFunctionalCase


@tagged("post_install", "-at_install", "nova")
class TestNovaAccount(NovaFunctionalCase):
    DATASET_KEYS = ("account_account", "account_journal", "account_move", "account_move_line",
                    "account_partial_reconcile")

    def test_datasets(self):
        self.assert_datasets_valid()

    def test_increase_rank_is_captured(self):
        # account bumps customer_rank with raw SQL (no write()): it must still emit an event.
        partner = self.env["res.partner"].create({"name": "Rango", "company_id": self.env.company.id})
        Event = self.env["nova.change.event"]
        domain = [("model_name", "=", "res.partner"), ("res_id", "=", partner.id)]
        before = Event.search_count(domain)
        partner._increase_rank("customer_rank")
        self.assertEqual(Event.search_count(domain), before + 1)

    def _invoice(self, amount=100.0):
        journal = self.env["account.journal"].search([("type", "=", "sale"), ("company_id", "=", self.company.id)], limit=1)
        if not journal:
            self.skipTest("Sin plan contable/diario de ventas en la base de pruebas")
        partner = self.env["res.partner"].create({"name": "Cliente factura"})
        move = self.env["account.move"].create({
            "move_type": "out_invoice", "partner_id": partner.id, "journal_id": journal.id,
            "invoice_date": fields.Date.from_string("2026-01-15"),
            "invoice_line_ids": [(0, 0, {"name": "Línea", "quantity": 1, "price_unit": amount, "tax_ids": []})]})
        move.action_post()
        return move

    def test_old_invoice_change_and_payment_update_receivable(self):
        move = self._invoice()
        _r, _m, records = self.full_cycle()
        self.assertTrue(self.records_of(records, "account_move", move.id))
        receivable = move.line_ids.filtered(lambda l: l.account_id.account_type == "asset_receivable")
        self.assertTrue(self.records_of(records, "account_move_line", receivable.id))
        # Payment: partial reconciliation changes the residual without writing the invoice header.
        register = self.env["account.payment.register"].with_context(
            active_model="account.move", active_ids=move.ids).create({"amount": 40.0})
        register._create_payments()
        _r, _m, records = self.full_cycle()
        line = self.records_of(records, "account_move_line", receivable.id)
        self.assertTrue(line, "la línea de cartera debe re-exportarse tras la conciliación")
        self.assertEqual(line[-1]["data"]["amount_residual"].rstrip("0").rstrip("."), "60")
        self.assertTrue(self.records_of(records, "account_partial_reconcile"))

    def test_credit_note_has_negative_balance_sign(self):
        move = self._invoice(50.0)
        refund = move._reverse_moves(default_values_list=[{"invoice_date": fields.Date.today()}])
        refund.action_post()
        _r, _m, records = self.full_cycle()
        lines = [r for r in self.records_of(records, "account_move_line") if r["data"].get("move_id") == refund.id
                 and r["data"].get("display_type") == "product"]
        self.assertTrue(lines)
        self.assertFalse(lines[0]["data"]["balance"].startswith("-"))  # refund product line is a debit
