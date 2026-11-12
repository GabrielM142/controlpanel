"""Change capture on the models exported by nova_stock (ORM create/write/unlink only)."""
from odoo import api, models


class StockWarehouse(models.Model):
    _name = "stock.warehouse"
    _inherit = ["stock.warehouse", "nova.capture.mixin"]


class StockLocation(models.Model):
    _name = "stock.location"
    _inherit = ["stock.location", "nova.capture.mixin"]


class StockPickingType(models.Model):
    _name = "stock.picking.type"
    _inherit = ["stock.picking.type", "nova.capture.mixin"]


class StockPicking(models.Model):
    _name = "stock.picking"
    _inherit = ["stock.picking", "nova.capture.mixin"]


class StockMove(models.Model):
    _name = "stock.move"
    _inherit = ["stock.move", "nova.capture.mixin"]


class StockQuant(models.Model):
    _name = "stock.quant"
    _inherit = ["stock.quant", "nova.capture.mixin"]

    @api.model
    def _merge_quants(self):
        """Odoo merges duplicated quants with raw SQL (UPDATE + DELETE), bypassing the
        ORM hooks and write_date: capture the deleted rows and the survivors."""
        if not self.env["nova.connection"]._nova_capture_flag():
            return super()._merge_quants()
        # Superset of the groups Odoo 16 merges (without in_date): extra survivors are
        # simply re-exported, but no deleted quant can be missed.
        self.env.cr.execute("""
            SELECT array_agg(id) FROM stock_quant
             GROUP BY product_id, company_id, location_id, lot_id, package_id, owner_id
            HAVING count(id) > 1""")
        ids = [i for row in self.env.cr.fetchall() for i in row[0]]
        refs_by_id = {}
        if ids:
            for row in self.browse(ids).sudo().read(["company_id", "product_id", "location_id"], load=None):
                refs_by_id[row["id"]] = row
        res = super()._merge_quants()
        if ids:
            quants = self.browse(ids).sudo()
            quants.invalidate_recordset()
            survivors = quants.exists()
            deleted = quants - survivors
            Event = self.env["nova.change.event"]
            if deleted:
                Event._nova_record(deleted, "delete", dataset_keys=["stock_quant"],
                                   refs_by_id={i: {k: v for k, v in refs_by_id[i].items() if k != "id"}
                                               for i in deleted.ids})
            if survivors:
                Event._nova_record(survivors, "upsert", dataset_keys=["stock_quant"])
        return res
