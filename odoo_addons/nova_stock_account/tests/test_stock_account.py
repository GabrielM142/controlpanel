from odoo.tests import tagged

from odoo.addons.nova_connector.tests.functional import NovaFunctionalCase


@tagged("post_install", "-at_install", "nova")
class TestNovaStockAccount(NovaFunctionalCase):
    DATASET_KEYS = ("stock_valuation_layer",)

    def test_datasets(self):
        self.assert_datasets_valid()
