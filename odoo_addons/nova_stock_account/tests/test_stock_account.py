from odoo.tests import tagged

from odoo.addons.nova_connector.tests.functional import NovaFunctionalCase


@tagged("post_install", "-at_install", "nova")
class TestNovaStockAccount(NovaFunctionalCase):
    DATASET_KEYS = ("stock_valuation_layer",)

    def test_datasets(self):
        self.assert_datasets_valid()

    def test_cost_lines_from_stock_moves_are_exported(self):
        # Continental + real-time valuation: the delivery entry (from a stock move) on the
        # category's stock output account is the cost of sales OMEGA uses for margins.
        company = self.env.company
        Account = self.env["account.account"]
        cost = Account.create({"name": "Costo de ventas NOVA", "code": "NOVA510", "account_type": "expense", "company_id": company.id})
        valuation = Account.create({"name": "Inventario NOVA", "code": "NOVA140", "account_type": "asset_current", "company_id": company.id})
        category = self.env["product.category"].create({"name": "NOVA costo"})
        category.with_company(company).property_stock_account_output_categ_id = cost
        product = self.env["product.product"].create({"name": "Producto costo", "type": "product", "categ_id": category.id})
        journal = self.env["account.journal"].search([("type", "=", "general"), ("company_id", "=", company.id)], limit=1)
        move = self.env["stock.move"].create({"name": "Entrega", "product_id": product.id, "product_uom_qty": 2,
            "product_uom": product.uom_id.id, "location_id": self.env.ref("stock.stock_location_stock").id,
            "location_dest_id": self.env.ref("stock.stock_location_customers").id})
        def entry(stock_move):
            return self.env["account.move"].create({"move_type": "entry", "journal_id": journal.id, "stock_move_id": stock_move,
                "line_ids": [(0, 0, {"account_id": cost.id, "debit": 30.0, "product_id": product.id, "quantity": 2}),
                             (0, 0, {"account_id": valuation.id, "credit": 30.0, "product_id": product.id, "quantity": 2})]})
        from_stock = entry(move.id).line_ids.filtered(lambda l: l.account_id == cost)
        manual = entry(False).line_ids.filtered(lambda l: l.account_id == cost)
        dataset = self.env["nova.export.dataset"].search([("key", "=", "account_move_line")])
        domain = dataset._nova_company_domain(dataset._nova_spec(), [company.id])
        found = self.env["account.move.line"].search(domain + [("id", "in", (from_stock | manual).ids)])
        self.assertEqual(found, from_stock, "solo el costo que viene de un movimiento de inventario")
