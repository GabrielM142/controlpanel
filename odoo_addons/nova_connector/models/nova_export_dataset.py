import json
import logging

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

from ..nova_lib import registry
from ..nova_lib.spec import exported_fields
from ..nova_lib.values import extra_value, to_contract

_logger = logging.getLogger(__name__)

EXTRA_TTYPES = ("char", "selection", "many2one", "integer", "boolean", "float", "monetary", "date")


class NovaExportDataset(models.Model):
    """A dataset is *declared in code* (``nova_spec.py`` of an addon). This
    record only stores per-database enablement, limits and diagnostics. There is
    deliberately no SQL/Python editor and no model chosen from the outside."""

    _name = "nova.export.dataset"
    _description = "NOVA export dataset"
    _order = "sequence, key"

    key = fields.Char(required=True, readonly=True, index=True)
    name = fields.Char(readonly=True)
    sequence = fields.Integer(default=10)
    addon = fields.Char(readonly=True)
    model_name = fields.Char(readonly=True)
    version = fields.Integer(readonly=True)
    mode = fields.Selection([("delta", "Delta"), ("snapshot_replace", "Sustitución de snapshot")],
                            readonly=True, default="delta")
    enabled = fields.Boolean(default=True)
    available = fields.Boolean(readonly=True, help="Addon instalado y modelo presente.")
    exported_fields = fields.Text(readonly=True)
    missing_required = fields.Text(readonly=True)
    missing_optional = fields.Text(readonly=True)
    sensitive_enabled = fields.Char(help="Campos PII habilitados explícitamente (coma).",
                                    groups="nova_connector.group_nova_admin")
    extra_field_ids = fields.Many2many("ir.model.fields", string="Campos adicionales (adaptador)",
                                       help="Campos personalizados autorizados (p. ej. adaptador del cliente).")
    reconcile_enabled = fields.Boolean(default=True)
    scan_enabled = fields.Boolean(default=True, help="Barrido de respaldo por (write_date, id).")
    last_error = fields.Text(readonly=True)

    _sql_constraints = [("key_uniq", "unique(key)", "Dataset duplicado")]

    @api.constrains("extra_field_ids")
    def _check_extra_fields(self):
        for rec in self:
            for field in rec.extra_field_ids:
                if field.model != rec.model_name or field.ttype not in EXTRA_TTYPES or not field.store:
                    raise ValidationError(_("Campo adicional no permitido: %s") % field.name)
                if field.name in rec._nova_spec().get("fields", {}):
                    raise ValidationError(_("%s ya forma parte del contrato") % field.name)

    # -------------------------------------------------------------- registry
    def _nova_spec(self):
        self.ensure_one()
        return registry.DATASETS.get(self.key) or {}

    @api.model
    def _nova_installed_addons(self):
        mods = self.env["ir.module.module"].sudo().search([("state", "in", ["installed", "to upgrade"]),
                                                            ("name", "=like", "nova_%")])
        return set(mods.mapped("name"))

    @api.model
    def _nova_sync_registry(self):
        installed = self._nova_installed_addons()
        existing = {d.key: d for d in self.sudo().with_context(active_test=False).search([])}
        for key, spec in registry.DATASETS.items():
            available = spec["addon"] in installed and spec["model"] in self.env
            vals = {"name": spec.get("description") or key, "addon": spec["addon"],
                    "model_name": spec["model"], "version": spec["version"], "mode": spec["mode"],
                    "available": available}
            if available:
                read, miss_req, miss_opt = exported_fields(spec, set(self.env[spec["model"]]._fields))
                vals.update({"missing_required": ", ".join(miss_req) or False,
                             "missing_optional": ", ".join(miss_opt) or False,
                             "exported_fields": ", ".join(read)})
            if key in existing:
                existing[key].sudo().write(vals)
            else:
                self.sudo().create(dict(vals, key=key))
        for key, rec in existing.items():
            if key not in registry.DATASETS:
                rec.sudo().write({"available": False})
        return True

    def _nova_usable(self):
        return self.filtered(lambda d: d.enabled and d.available and not d.missing_required)

    # -------------------------------------------------------------- reading
    def _nova_read_plan(self):
        self.ensure_one()
        spec = self._nova_spec()
        Model = self.env[spec["model"]]
        sensitive = set(filter(None, (self.sudo().sensitive_enabled or "").replace(" ", "").split(",")))
        read, miss_req, _miss_opt = exported_fields(spec, set(Model._fields), sensitive)
        if miss_req:
            raise ValidationError(_("Dataset %s: faltan campos %s") % (self.key, ", ".join(miss_req)))
        extras = [(f.name, f.ttype) for f in self.extra_field_ids if f.name in Model._fields]
        return spec, read, extras

    def _nova_company_domain(self, spec, company_ids):
        scope = spec["company_scope"]
        if scope == "strict":
            return [("company_id", "in", company_ids)]
        if scope == "shared":
            return ["|", ("company_id", "=", False), ("company_id", "in", company_ids)]
        if scope == "self":
            return [("id", "in", company_ids)]
        return []

    def _nova_model(self):
        self.ensure_one()
        # active_test=False: archived products/partners must keep flowing (history).
        return self.env[self._nova_spec()["model"]].with_context(active_test=False, prefetch_fields=False)

    def _nova_digits(self, Model, name):
        field = Model._fields[name]
        if field.type == "monetary":
            return None  # currency-dependent; keep full stored precision
        digits = getattr(field, "get_digits", None)
        if digits:
            value = field.get_digits(Model.env)
            if value and value[1] is not None:
                return value[1]
        return None

    def _nova_serialize(self, records, reason):
        """Return contract records for ``records`` (already filtered by company)."""
        self.ensure_one()
        spec, read, extras = self._nova_read_plan()
        Model = records.with_context(active_test=False, prefetch_fields=False)
        names = list(read) + ["write_date"]
        rows = Model.read(names, load=None) if names else [{"id": r.id} for r in Model]
        extra_rows = {}
        if extras:
            for row in Model.read([n for n, _t in extras]):
                extra_rows[row["id"]] = row
        digits = {n: self._nova_digits(Model, n) for n in read if spec["fields"][n]["type"] == "decimal"}
        out = []
        for row in rows:
            data = {}
            for name in read:
                ftype = spec["fields"][name]["type"]
                data[name] = to_contract(row.get(name), ftype, digits.get(name))
            data["write_date"] = to_contract(row.get("write_date"), "datetime")
            if extras:
                data["extra"] = {n: extra_value(extra_rows.get(row["id"], {}).get(n), t) for n, t in extras}
            company = data.get("company_id") if "company_id" in data else None
            if spec["company_scope"] == "self":
                company = row["id"]
            out.append({"op": "upsert", "id": row["id"], "company_id": company, "data": data,
                        "reason": reason})
        return out

    def _nova_reconcile(self, company_ids):
        """Cheap count/sum(id) per company; central compares with its own state."""
        self.ensure_one()
        spec = self._nova_spec()
        Model = self._nova_model()
        domain = self._nova_company_domain(spec, company_ids)
        groupby = ["company_id"] if "company_id" in Model._fields and spec["company_scope"] != "self" else []
        result = []
        for group in Model.read_group(domain, ["id:sum"], groupby, lazy=False):
            company = group.get("company_id")
            if isinstance(company, (list, tuple)):
                company = company[0]
            result.append({"dataset": self.key, "company_id": company or None,
                           "count": group.get("__count", 0), "id_sum": str(group.get("id") or 0)})
        return result

    def action_sync_registry(self):
        self._nova_sync_registry()
