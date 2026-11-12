"""Process-wide registry of dataset specs declared in code by NOVA addons.

The registry is filled at import time, but an Odoo process may serve several
databases: a spec is only *active* in a database where its addon is installed
(checked by ``nova.export.dataset._nova_sync_registry``)."""
from __future__ import annotations

from .spec import normalize_dataset, normalize_dependencies

DATASETS = {}
DEPENDENCIES = []


def register(addon, datasets, dependencies=()):
    for raw in datasets:
        spec = normalize_dataset(addon, raw)
        existing = DATASETS.get(spec["key"])
        if existing and existing["addon"] != addon:
            raise ValueError("dataset %s ya registrado por %s" % (spec["key"], existing["addon"]))
        DATASETS[spec["key"]] = spec
    for dep in normalize_dependencies(addon, dependencies):
        if dep not in DEPENDENCIES:
            DEPENDENCIES.append(dep)


def specs_for_model(model_name):
    return [s for s in DATASETS.values() if s["model"] == model_name]


def dependencies_for_model(model_name):
    return [d for d in DEPENDENCIES if d["model"] == model_name]
