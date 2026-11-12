from odoo.tests import tagged

from odoo.addons.nova_connector.tests.functional import NovaFunctionalCase


@tagged("post_install", "-at_install", "nova")
class TestNovaStock(NovaFunctionalCase):
    DATASET_KEYS = ("stock_warehouse", "stock_location", "stock_picking_type", "stock_picking",
                    "stock_move", "stock_quant")

    def test_datasets(self):
        self.assert_datasets_valid()

    def test_quant_update_is_captured(self):
        product = self.env["product.product"].create({"name": "Sartén", "detailed_type": "product"})
        warehouse = self.env["stock.warehouse"].search([("company_id", "=", self.company.id)], limit=1)
        self.full_cycle()
        self.env["stock.quant"]._update_available_quantity(product, warehouse.lot_stock_id, 7.0)
        _r, _m, records = self.full_cycle()
        quants = [r for r in self.records_of(records, "stock_quant") if r["data"].get("product_id") == product.id]
        self.assertTrue(quants)
        self.assertEqual(quants[-1]["data"]["quantity"].split(".")[0], "7")
