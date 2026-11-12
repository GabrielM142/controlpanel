"""Dataset specification format (contract ``nova.export.v1``).

Every functional addon declares its datasets in a ``nova_spec.py`` module that
only contains literals. A field declaration is ``"type[,flag...]"``:

types   id | m2o | m2m | int | bool | string | selection | decimal | date | datetime
flags   opt  -> exported only if the field exists in the installed Odoo model
        pii  -> personal data, excluded unless explicitly enabled on the dataset
        cost -> cost/valuation data (exported, labelled sensitive)
        price-> sales price data (exported, labelled sensitive)

``id`` and ``write_date`` are implicit for every dataset.
"""
from __future__ import annotations

TYPES = ("id", "m2o", "m2m", "int", "bool", "string", "selection", "decimal", "date", "datetime")
FLAGS = ("opt", "pii", "cost", "price")
COMPANY_SCOPES = ("strict", "shared", "self", "none")
MODES = ("delta", "snapshot_replace")
IMPLICIT_FIELDS = {"id": "id", "write_date": "datetime"}


class SpecError(ValueError):
    pass


def parse_field(decl):
    parts = [p.strip() for p in decl.split(",") if p.strip()]
    if not parts or parts[0] not in TYPES:
        raise SpecError("tipo de campo inválido: %r" % (decl,))
    flags = parts[1:]
    for flag in flags:
        if flag not in FLAGS:
            raise SpecError("flag inválido %r en %r" % (flag, decl))
    return {"type": parts[0], "optional": "opt" in flags,
            "sensitivity": [f for f in flags if f in ("pii", "cost", "price")]}


def normalize_dataset(addon, raw):
    """Validate a literal dataset declaration and return a normalized dict."""
    required = ("key", "version", "model", "company_scope", "fields")
    for name in required:
        if name not in raw:
            raise SpecError("%s: falta %s" % (raw.get("key", "?"), name))
    key = raw["key"]
    if not key.replace("_", "").isalnum() or key.lower() != key:
        raise SpecError("clave de dataset inválida: %r" % key)
    if raw["company_scope"] not in COMPANY_SCOPES:
        raise SpecError("%s: company_scope inválido" % key)
    mode = raw.get("mode", "delta")
    if mode not in MODES:
        raise SpecError("%s: modo inválido" % key)
    fields = {}
    for name, decl in raw["fields"].items():
        if name in IMPLICIT_FIELDS:
            raise SpecError("%s: %s es implícito" % (key, name))
        fields[name] = parse_field(decl)
    capture = raw.get("capture") or {}
    trigger = capture.get("fields")
    if trigger is not None:
        unknown = [f for f in trigger if f not in fields]
        if unknown:
            raise SpecError("%s: capture.fields desconocidos %s" % (key, unknown))
    refs = capture.get("refs", [])
    for ref in refs:
        if ref not in fields:
            raise SpecError("%s: ref desconocida %s" % (key, ref))
    children = raw.get("children", [])
    return {
        "addon": addon,
        "key": key,
        "version": int(raw["version"]),
        "min_version": int(raw.get("min_version", raw["version"])),
        "model": raw["model"],
        "company_scope": raw["company_scope"],
        "mode": mode,
        "business_date": raw.get("business_date"),
        "fields": fields,
        "capture": {"fields": list(trigger) if trigger is not None else None, "refs": list(refs)},
        "children": [{"dataset": c["dataset"], "fk": c["fk"]} for c in children],
        "description": raw.get("description", ""),
    }


def normalize_dependencies(addon, raw_list):
    out = []
    for dep in raw_list or []:
        for name in ("model", "fields", "dataset"):
            if name not in dep:
                raise SpecError("dependencia sin %s" % name)
        out.append({"addon": addon, "model": dep["model"], "fields": list(dep["fields"]),
                    "dataset": dep["dataset"], "description": dep.get("description", "")})
    return out


def exported_fields(dataset, available=None, enabled_sensitive=()):
    """Return (fields_to_read, missing_required, missing_optional).

    ``available`` is the set of field names present in the installed model;
    ``None`` means "assume everything exists" (contract generation).
    """
    read, missing_required, missing_optional = [], [], []
    for name, meta in dataset["fields"].items():
        if available is not None and name not in available:
            (missing_optional if meta["optional"] else missing_required).append(name)
            continue
        if "pii" in meta["sensitivity"] and name not in enabled_sensitive:
            continue
        read.append(name)
    return read, missing_required, missing_optional
