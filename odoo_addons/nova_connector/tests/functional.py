from .common import NovaCase


class NovaFunctionalCase(NovaCase):
    """Base for functional addons: every declared dataset must map onto real
    Odoo 16 fields of the installed modules (this is the check that catches a
    wrong technical field name before any client installation)."""

    DATASET_KEYS = ()

    def assert_datasets_valid(self):
        for key in self.DATASET_KEYS:
            ds = self.env["nova.export.dataset"].search([("key", "=", key)])
            self.assertTrue(ds, key)
            self.assertTrue(ds.available, key)
            self.assertFalse(ds.missing_required, "%s: %s" % (key, ds.missing_required))
            spec, read, _extras = ds._nova_read_plan()
            for name in read:
                self.assertIn(name, self.env[spec["model"]]._fields, "%s.%s" % (key, name))

    def records_of(self, records, dataset, res_id=None):
        return [r for r in records if r["dataset"] == dataset and (res_id is None or r["id"] == res_id)]
