"""Monthly trial balance per account (read-only SQL view) exported as a snapshot.

OMEGA's financial report (P&L, expenses by function, balance-sheet ratios) needs every
account, but exporting every journal item would multiply the volume. This view keeps one
row per company, account and month with posted debit, credit and balance: a few thousand
rows that are re-sent whole on each close (snapshot_replace).
"""
from odoo import fields, models, tools


class NovaAccountBalanceMonth(models.Model):
    _name = "nova.account.balance.month"
    _description = "NOVA: saldo mensual por cuenta"
    _auto = False
    _log_access = False
    _order = "id"

    company_id = fields.Many2one("res.company", readonly=True)
    account_id = fields.Many2one("account.account", readonly=True)
    code = fields.Char(readonly=True)
    name = fields.Char(readonly=True)
    account_type = fields.Char(readonly=True)
    month = fields.Date(readonly=True)
    debit = fields.Float(digits=(16, 2), readonly=True)
    credit = fields.Float(digits=(16, 2), readonly=True)
    balance = fields.Float(digits=(16, 2), readonly=True)
    write_date = fields.Datetime(readonly=True)

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        # Stable id per (account, month): accounts belong to one company in Odoo 16.
        self.env.cr.execute("""
            CREATE OR REPLACE VIEW %s AS
            SELECT (l.account_id::bigint * 100000
                    + extract(year FROM date_trunc('month', l.date))::int * 12 + extract(month FROM date_trunc('month', l.date))::int - 1) AS id,
                   l.company_id, l.account_id, a.code, a.name::varchar AS name, a.account_type::varchar AS account_type,
                   date_trunc('month', l.date)::date AS month,
                   round(sum(l.debit), 2) AS debit, round(sum(l.credit), 2) AS credit,
                   round(sum(l.balance), 2) AS balance, max(l.write_date) AS write_date
              FROM account_move_line l
              JOIN account_account a ON a.id = l.account_id
             WHERE l.parent_state = 'posted'
             GROUP BY l.company_id, l.account_id, a.code, a.name, a.account_type, date_trunc('month', l.date)
        """ % self._table)
