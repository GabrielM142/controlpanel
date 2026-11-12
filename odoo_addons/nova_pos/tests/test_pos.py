from odoo.tests import tagged

from odoo.addons.nova_connector.tests.functional import NovaFunctionalCase


@tagged("post_install", "-at_install", "nova")
class TestNovaPos(NovaFunctionalCase):
    DATASET_KEYS = ("pos_config", "pos_session", "pos_order", "pos_order_line")

    def test_datasets(self):
        self.assert_datasets_valid()
