from odoo.exceptions import ValidationError
from odoo.tests import tagged

from odoo.addons.nova_connector.tests.common import NovaCase


@tagged("post_install", "-at_install", "nova")
class TestNovaJuj(NovaCase):

    def _field(self, model, name):
        return self.env["ir.model.fields"].search([("model", "=", model), ("name", "=", name)])

    def test_mapping_exports_extra_field_and_capability(self):
        dataset = self.env["nova.export.dataset"].search([("key", "=", "res_partner")])
        field = self._field("res.partner", "function")  # stand-in char field; real JUJ field to confirm
        mapping = self.env["nova.juj.attribute.map"].create({
            "attribute": "zone", "dataset_id": dataset.id, "field_id": field.id, "note": "prueba"})
        self.assertIn(field, dataset.extra_field_ids)
        caps = self.api().get_capabilities()
        self.assertIn({"attribute": "zone", "dataset": "res_partner", "field": "function", "ttype": "char",
                       "relation": None, "adapter": "nova_juj"}, caps["attribute_map"])
        partner = self.env["res.partner"].create({"name": "Con zona", "function": "zona-1"})
        _r, _m, records = self.full_cycle()
        rec = [r for r in records if r["dataset"] == "res_partner" and r["id"] == partner.id][-1]
        self.assertEqual(rec["data"]["extra"]["function"], "zona-1")
        mapping.unlink()
        self.assertNotIn(field, dataset.extra_field_ids)

    def test_mapping_rejects_foreign_model_field(self):
        dataset = self.env["nova.export.dataset"].search([("key", "=", "res_partner")])
        with self.assertRaises(ValidationError):
            self.env["nova.juj.attribute.map"].create({"attribute": "brand", "dataset_id": dataset.id,
                                                       "field_id": self._field("res.users", "login").id})
