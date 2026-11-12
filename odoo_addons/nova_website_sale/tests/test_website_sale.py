from odoo.tests import tagged

from odoo.addons.nova_connector.tests.functional import NovaFunctionalCase


@tagged("post_install", "-at_install", "nova")
class TestNovaWebsiteSale(NovaFunctionalCase):
    DATASET_KEYS = ("website", "website_sale_order")

    def test_datasets(self):
        self.assert_datasets_valid()

    def test_only_web_orders_are_exported(self):
        website = self.env["website"].search([("company_id", "=", self.company.id)], limit=1) or \
            self.env["website"].create({"name": "Tienda NOVA", "company_id": self.company.id})
        partner = self.env["res.partner"].create({"name": "Cliente web"})
        product = self.env["product.product"].create({"name": "Producto web", "list_price": 12.0})
        line = [(0, 0, {"product_id": product.id, "product_uom_qty": 1, "price_unit": 12.0})]
        web = self.env["sale.order"].create({"partner_id": partner.id, "website_id": website.id,
                                             "order_line": line})
        shop = self.env["sale.order"].create({"partner_id": partner.id, "order_line": line})
        _r, _m, records = self.full_cycle()
        self.assertTrue(self.records_of(records, "website", website.id))
        web_rows = self.records_of(records, "website_sale_order", web.id)
        self.assertTrue(web_rows and web_rows[-1]["data"]["website_id"] == website.id)
        self.assertFalse([r for r in self.records_of(records, "website_sale_order", shop.id)
                          if r["op"] == "upsert"])
        # Both orders still flow through the normal sale_order dataset.
        self.assertTrue(self.records_of(records, "sale_order", web.id))
        self.assertTrue(self.records_of(records, "sale_order", shop.id))
