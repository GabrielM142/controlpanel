"""Monthly warehouse operations (read-only SQL view) exported as a snapshot.

Two small series OMEGA's Logística report needs without exporting every stock move:
- adjust: inventory adjustments (moves flagged is_inventory) valued by their layers;
- prep: validated outgoing deliveries and the hours from creation to validation.
"""
from odoo import fields, models, tools


class NovaStockOpsMonth(models.Model):
    _name = "nova.stock.ops.month"
    _description = "NOVA: operaciones de bodega por mes"
    _auto = False
    _log_access = False
    _order = "id"

    company_id = fields.Many2one("res.company", readonly=True)
    kind = fields.Char(readonly=True)
    month = fields.Date(readonly=True)
    moves = fields.Integer(readonly=True)
    products = fields.Integer(readonly=True)
    value_net = fields.Float(digits=(16, 2), readonly=True)
    value_abs = fields.Float(digits=(16, 2), readonly=True)
    hours = fields.Float(digits=(16, 2), readonly=True)
    write_date = fields.Datetime(readonly=True)

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        ym = "(extract(year FROM {m})::int * 12 + extract(month FROM {m})::int - 1)"
        adj_m = "date_trunc('month', v.create_date)"
        prep_m = "date_trunc('month', p.date_done)"
        self.env.cr.execute("""
            CREATE OR REPLACE VIEW {table} AS
            SELECT (v.company_id::bigint * 1000000 + 100000 + {adj_ym}) AS id, v.company_id,
                   'adjust'::varchar AS kind, {adj_m}::date AS month,
                   count(*)::int AS moves, count(DISTINCT v.product_id)::int AS products,
                   round(sum(v.value), 2) AS value_net, round(sum(abs(v.value)), 2) AS value_abs,
                   0::numeric AS hours, max(v.write_date) AS write_date
              FROM stock_valuation_layer v
              JOIN stock_move sm ON sm.id = v.stock_move_id
             WHERE sm.is_inventory
             GROUP BY v.company_id, {adj_m}
            UNION ALL
            SELECT (p.company_id::bigint * 1000000 + 200000 + {prep_ym}) AS id, p.company_id,
                   'prep'::varchar AS kind, {prep_m}::date AS month,
                   count(*)::int AS moves, 0 AS products, 0::numeric AS value_net, 0::numeric AS value_abs,
                   round(sum(extract(epoch FROM (p.date_done - p.create_date)) / 3600)::numeric, 2) AS hours,
                   max(p.write_date) AS write_date
              FROM stock_picking p
              JOIN stock_picking_type t ON t.id = p.picking_type_id
             WHERE t.code = 'outgoing' AND p.state = 'done' AND p.date_done IS NOT NULL
               AND p.date_done >= p.create_date
             GROUP BY p.company_id, {prep_m}
        """.format(table=self._table, adj_m=adj_m, prep_m=prep_m,
                   adj_ym=ym.format(m=adj_m), prep_ym=ym.format(m=prep_m)))
