from odoo.tests import tagged

from odoo.addons.nova_connector.tests.functional import NovaFunctionalCase


@tagged("post_install", "-at_install", "nova")
class TestNovaPurchase(NovaFunctionalCase):
    DATASET_KEYS = ("purchase_order", "purchase_order_line")

    def test_datasets(self):
        self.assert_datasets_valid()

    def test_purchase_line_captured(self):
        vendor = self.env["res.partner"].create({"name": "Proveedor"})
        product = self.env["product.product"].create({"name": "Insumo", "detailed_type": "product"})
        order = self.env["purchase.order"].create({
            "partner_id": vendor.id,
            "order_line": [(0, 0, {"product_id": product.id, "product_qty": 4, "price_unit": 2.5})]})
        _r, _m, records = self.full_cycle()
        self.assertTrue(self.records_of(records, "purchase_order", order.id))
        self.assertTrue(self.records_of(records, "purchase_order_line", order.order_line.id))
