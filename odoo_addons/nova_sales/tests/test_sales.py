from odoo.tests import tagged

from odoo.addons.nova_connector.tests.functional import NovaFunctionalCase


@tagged("post_install", "-at_install", "nova")
class TestNovaSales(NovaFunctionalCase):
    DATASET_KEYS = ("crm_team", "sale_order", "sale_order_line")

    def test_datasets(self):
        self.assert_datasets_valid()

    def test_order_line_change_and_delete(self):
        partner = self.env["res.partner"].create({"name": "Cliente pedido"})
        product = self.env["product.product"].create({"name": "Olla", "list_price": 10.0})
        order = self.env["sale.order"].create({
            "partner_id": partner.id,
            "order_line": [(0, 0, {"product_id": product.id, "product_uom_qty": 2, "price_unit": 10.0}),
                           (0, 0, {"product_id": product.id, "product_uom_qty": 1, "price_unit": 5.0})]})
        _r, _m, records = self.full_cycle()
        self.assertEqual(len(self.records_of(records, "sale_order", order.id)), 1)
        self.assertEqual(len({r["id"] for r in self.records_of(records, "sale_order_line")
                              if r["data"].get("order_id") == order.id}), 2)
        removed = order.order_line[1]
        removed_id = removed.id
        order.write({"order_line": [(2, removed_id)]})
        order.order_line[0].write({"product_uom_qty": 3})
        _r, _m, records = self.full_cycle()
        deleted = self.records_of(records, "sale_order_line", removed_id)
        self.assertEqual(deleted[-1]["op"], "delete")
        self.assertEqual(deleted[-1]["refs"]["order_id"], order.id)
        changed = self.records_of(records, "sale_order_line", order.order_line[0].id)
        self.assertEqual(changed[-1]["data"]["product_uom_qty"], "3.00")
