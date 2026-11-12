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

    def _nova_dependency_targets(self):
        """{dataset_key: recordset} of records whose exported data depends on self.
        Read with sudo: capture must never raise AccessError into business code."""
        out = {}
        records = self.sudo().with_context(active_test=False)
        for dep in registry.dependencies_for_model(self._name):
            if dep["dataset"] not in registry.DATASETS:
                continue
            targets = self.env[registry.DATASETS[dep["dataset"]]["model"]].sudo()
            for fname in dep["fields"]:
                if fname.split(".")[0] in self._fields:
                    targets |= records.mapped(fname)
            if targets:
                out[dep["dataset"]] = out.get(dep["dataset"], targets.browse()) | targets
        return out

    def _nova_capture_dependencies(self, op, previous=None):
        targets_by_key = self._nova_dependency_targets()
        for key, old in (previous or {}).items():
            targets_by_key[key] = targets_by_key.get(key, old.browse()) | old
        for key, targets in targets_by_key.items():
            targets = targets.exists()
            if targets:
                self.env["nova.change.event"]._nova_record(targets, "upsert", dataset_keys=[key])

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records.env["nova.change.event"]._nova_record(records, "upsert")
        records._nova_capture_dependencies("create")
        return records

    def write(self, vals):
        previous = None
        deps = registry.dependencies_for_model(self._name)
        dep_changed = False
        if deps and self.env["nova.connection"]._nova_capture_flag():
            dep_fields = {f.split(".")[0] for d in deps for f in d["fields"]}
            if dep_fields & set(vals):
                dep_changed = True
                # Targets before the write too: a re-pointed link must refresh the old record.
                previous = self._nova_dependency_targets()
        res = super().write(vals)
        trigger = self._nova_trigger_fields()
        if trigger is None or trigger & set(vals) or "active" in vals or "company_id" in vals:
            self.env["nova.change.event"]._nova_record(self, "upsert")
        if dep_changed:
            self._nova_capture_dependencies("write", previous=previous)
        return res

    def unlink(self):
        refs_by_id = {}
        if self.env["nova.connection"]._nova_capture_flag():
            ref_names = set()
            for spec in registry.specs_for_model(self._name):
                ref_names.update(spec["capture"]["refs"])
            ref_names = [n for n in ref_names if n in self._fields]
            if ref_names:
                for row in self.sudo().with_context(active_test=False).read(ref_names, load=None):
                    refs_by_id[row["id"]] = {k: row.get(k) for k in ref_names}
            self.env["nova.change.event"]._nova_record(self, "delete", refs_by_id=refs_by_id)
            # Related records (e.g. move lines of a deleted reconciliation) change state.
            self._nova_capture_dependencies("unlink")
        return super().unlink()
