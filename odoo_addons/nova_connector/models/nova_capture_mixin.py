from odoo import api, models

from ..nova_lib import registry


class NovaCaptureMixin(models.AbstractModel):
    """Add to an existing model with ``_inherit = ['<model>', 'nova.capture.mixin']``.

    Only ORM create/write/unlink are hooked. Not covered (documented, detected
    by reconciliation + ``write_date`` scan): raw SQL, ``ON DELETE CASCADE`` of
    children (handled centrally through the dataset ``children`` declaration)
    and stored computed fields recomputed via ``_write`` (they bump
    ``write_date`` and are caught by the fallback scan)."""

    _name = "nova.capture.mixin"
    _description = "NOVA change capture mixin"

    def _nova_trigger_fields(self):
        names = set()
        for spec in registry.specs_for_model(self._name):
            trigger = spec["capture"]["fields"]
            if trigger is None:
                return None
            names.update(trigger)
        return names

    def _nova_capture_dependencies(self, op):
        for dep in registry.dependencies_for_model(self._name):
            targets = self.env[registry.DATASETS[dep["dataset"]]["model"]] if dep["dataset"] in registry.DATASETS else None
            if targets is None:
                continue
            for fname in dep["fields"]:
                if fname in self._fields:
                    targets |= self.mapped(fname)
            if targets:
                self.env["nova.change.event"]._nova_record(targets, "upsert", dataset_keys=[dep["dataset"]])

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records.env["nova.change.event"]._nova_record(records, "upsert")
        records._nova_capture_dependencies("create")
        return records

    def write(self, vals):
        res = super().write(vals)
        trigger = self._nova_trigger_fields()
        if trigger is None or trigger & set(vals) or "active" in vals or "company_id" in vals:
            self.env["nova.change.event"]._nova_record(self, "upsert")
        if registry.dependencies_for_model(self._name):
            dep_fields = {f for d in registry.dependencies_for_model(self._name) for f in d["fields"]}
            if dep_fields & set(vals):
                self._nova_capture_dependencies("write")
        return res

    def unlink(self):
        refs_by_id = {}
        if self.env["nova.connection"]._nova_capture_flag():
            ref_names = set()
            for spec in registry.specs_for_model(self._name):
                ref_names.update(spec["capture"]["refs"])
            ref_names = [n for n in ref_names if n in self._fields]
            if ref_names:
                for row in self.with_context(active_test=False).read(ref_names, load=None):
                    refs_by_id[row["id"]] = {k: row.get(k) for k in ref_names}
            self.env["nova.change.event"]._nova_record(self, "delete", refs_by_id=refs_by_id)
            # Related records (e.g. move lines of a deleted reconciliation) change state.
            self._nova_capture_dependencies("unlink")
        return super().unlink()
