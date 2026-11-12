from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

ATTRIBUTES = [
    ("brand", "Marca"),
    ("business_unit", "Unidad de negocio"),
    ("channel", "Canal"),
    ("zone", "Zona"),
    ("canton", "Cantón"),
]


class NovaJujAttributeMap(models.Model):
    """Semantic attribute -> real stored field of an exported dataset."""

    _name = "nova.juj.attribute.map"
    _description = "NOVA JUJ attribute mapping"
    _order = "attribute, id"

    attribute = fields.Selection(ATTRIBUTES, required=True)
    dataset_id = fields.Many2one("nova.export.dataset", required=True, ondelete="cascade")
    model_name = fields.Char(related="dataset_id.model_name")
    field_id = fields.Many2one("ir.model.fields", required=True, ondelete="cascade",
                               domain="[('model', '=', model_name), ('store', '=', True)]")
    active = fields.Boolean(default=True)
    note = fields.Char(help="Validación con JUJ: quién confirmó el mapeo y cuándo.")

    _sql_constraints = [("attr_dataset_uniq", "unique(attribute, dataset_id)",
                         "Un solo campo por atributo y dataset")]

    @api.constrains("field_id", "dataset_id")
    def _check_field(self):
        for rec in self:
            if rec.field_id.model != rec.dataset_id.model_name:
                raise ValidationError(_("El campo %s no pertenece a %s.") % (rec.field_id.name, rec.dataset_id.model_name))
            if not rec.field_id.store:
                raise ValidationError(_("Solo se admiten campos almacenados."))

    def _sync_extra_fields(self, datasets):
        for dataset in datasets:
            maps = self.sudo().search([("dataset_id", "=", dataset.id), ("active", "=", True)])
            wanted = maps.mapped("field_id")
            dataset.sudo().write({"extra_field_ids": [(6, 0, wanted.ids)]})

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        self._sync_extra_fields(records.mapped("dataset_id"))
        return records

    def write(self, vals):
        before = self.mapped("dataset_id")
        res = super().write(vals)
        self._sync_extra_fields(before | self.mapped("dataset_id"))
        return res

    def unlink(self):
        datasets = self.mapped("dataset_id")
        res = super().unlink()
        self._sync_extra_fields(datasets)
        return res


class NovaConnectorApi(models.AbstractModel):
    _inherit = "nova.connector"

    @api.model
    def _nova_attribute_map(self):
        result = super()._nova_attribute_map()
        for rec in self.env["nova.juj.attribute.map"].sudo().search([("active", "=", True)]):
            result.append({"attribute": rec.attribute, "dataset": rec.dataset_id.key,
                           "field": rec.field_id.name, "ttype": rec.field_id.ttype,
                           "relation": rec.field_id.relation or None, "adapter": "nova_juj"})
        return result
