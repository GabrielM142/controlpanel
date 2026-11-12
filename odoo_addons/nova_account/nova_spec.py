"""Datasets of nova_account: invoices/credit notes, receivable items and reconciliations."""

DATASETS = [
    {"key": "account_account", "version": 1, "model": "account.account", "company_scope": "strict",
     "description": "Plan de cuentas",
     "fields": {"code": "string", "name": "string", "account_type": "selection", "company_id": "m2o",
                "deprecated": "bool", "reconcile": "bool"},
     "capture": {"fields": None, "refs": ["company_id"]}},
    {"key": "account_journal", "version": 1, "model": "account.journal", "company_scope": "strict",
     "description": "Diarios",
     "fields": {"name": "string", "code": "string", "type": "selection", "company_id": "m2o",
                "active": "bool"},
     "capture": {"fields": None, "refs": ["company_id"]}},
    {"key": "account_move", "version": 1, "model": "account.move", "company_scope": "strict",
     "description": "Asientos/facturas (encabezado)", "business_date": "invoice_date",
     "fields": {"name": "string", "move_type": "selection", "state": "selection", "date": "date",
                "invoice_date": "date", "invoice_date_due": "date", "partner_id": "m2o",
                "commercial_partner_id": "m2o", "invoice_user_id": "m2o", "journal_id": "m2o",
                "company_id": "m2o", "currency_id": "m2o", "amount_untaxed_signed": "decimal",
                "amount_total_signed": "decimal", "amount_residual_signed": "decimal",
                "payment_state": "selection", "reversed_entry_id": "m2o", "invoice_origin": "string",
                "team_id": "m2o,opt"},
     "capture": {"fields": None, "refs": ["company_id", "partner_id", "invoice_date", "date", "move_type"]},
     # Only what OMEGA reads: customer invoices and credit notes. Inventory valuation,
     # bank and vendor entries (~95% of the moves in a real database) are not exported;
     # receivable lines of payments carry their own partner and parent_state.
     "domain": [["move_type", "in", ["out_invoice", "out_refund"]]],
     "children": [{"dataset": "account_move_line", "fk": "move_id"}]},
    {"key": "account_move_line", "version": 1, "model": "account.move.line", "company_scope": "strict",
     "description": "Apuntes que lee OMEGA: ingresos de factura, costo de ventas (cogs) y cartera",
     # Sales use income + direct-cost lines of customer invoices; receivables use the
     # asset_receivable lines of any move (invoices and payments). Bank, tax, payable,
     # stock-interim and expense lines (~78% of a real ledger) are not exported.
     "domain": [["account_id.account_type", "in",
                 ["asset_receivable", "income", "income_other", "expense_direct_cost"]]],
     "fields": {"move_id": "m2o", "account_id": "m2o", "partner_id": "m2o", "product_id": "m2o",
                "product_uom_id": "m2o", "quantity": "decimal", "price_unit": "decimal,price",
                "discount": "decimal", "price_subtotal": "decimal,price", "price_total": "decimal,price",
                "balance": "decimal", "debit": "decimal", "credit": "decimal",
                "amount_currency": "decimal", "currency_id": "m2o", "company_id": "m2o",
                "date": "date", "date_maturity": "date", "display_type": "selection",
                "amount_residual": "decimal", "amount_residual_currency": "decimal",
                "reconciled": "bool", "full_reconcile_id": "m2o", "parent_state": "selection",
                "journal_id": "m2o", "sale_line_ids": "m2m,opt"},
     "capture": {"fields": None, "refs": ["move_id", "company_id", "account_id", "product_id", "date"]}},
    {"key": "account_partial_reconcile", "version": 1, "model": "account.partial.reconcile",
     "company_scope": "strict", "description": "Conciliaciones parciales (pagos aplicados)",
     "fields": {"debit_move_id": "m2o", "credit_move_id": "m2o", "amount": "decimal",
                "debit_amount_currency": "decimal", "credit_amount_currency": "decimal",
                "max_date": "date", "company_id": "m2o", "full_reconcile_id": "m2o"},
     "capture": {"fields": None, "refs": ["debit_move_id", "credit_move_id", "company_id", "max_date"]}},
]

# A reconciliation changes residuals of both lines without writing them through
# the ORM write(): enqueue the lines too, on create and unlink.
DEPENDENCIES = [
    {"model": "account.partial.reconcile", "fields": ["debit_move_id", "credit_move_id"],
     "dataset": "account_move_line", "description": "Pago/conciliación actualiza cartera"},
]
