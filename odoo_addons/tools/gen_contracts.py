"""Generate contracts/datasets.json and per-dataset JSON Schemas from the
addons' nova_spec.py files (the producer is the single source of truth).

    python odoo_addons/tools/gen_contracts.py           # write
    python odoo_addons/tools/gen_contracts.py --check   # fail if out of date
"""
import ast
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ADDONS = os.path.dirname(HERE)
REPO = os.path.dirname(ADDONS)
sys.path.insert(0, os.path.join(ADDONS, "nova_connector"))

from nova_lib.spec import normalize_dataset, normalize_dependencies  # noqa: E402

ORDER = ["nova_master_data", "nova_sales", "nova_account", "nova_stock", "nova_stock_account",
         "nova_purchase", "nova_pos"]
DEC = "^-?[0-9]+(\\.[0-9]+)?$"
DT = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
DATE = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"


def load_spec(addon):
    path = os.path.join(ADDONS, addon, "nova_spec.py")
    tree = ast.parse(open(path, encoding="utf-8").read(), path)
    values = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            values[node.targets[0].id] = ast.literal_eval(node.value)  # literals only, never executed
    return values.get("DATASETS", []), values.get("DEPENDENCIES", [])


def field_schema(meta):
    t = meta["type"]
    if t == "id":
        return {"type": "integer", "minimum": 1}
    if t == "bool":
        return {"type": "boolean"}
    if t == "m2m":
        return {"type": "array", "items": {"type": "integer", "minimum": 1}}
    base = {"m2o": {"type": "integer", "minimum": 1}, "int": {"type": "integer"},
            "string": {"type": "string", "maxLength": 4000}, "selection": {"type": "string", "maxLength": 128},
            "decimal": {"type": "string", "pattern": DEC, "maxLength": 64},
            "date": {"type": "string", "pattern": DATE}, "datetime": {"type": "string", "pattern": DT}}[t]
    return {"anyOf": [base, {"type": "null"}]}


def build():
    datasets, dependencies = [], []
    for addon in ORDER:
        raw, deps = load_spec(addon)
        datasets += [normalize_dataset(addon, d) for d in raw]
        dependencies += normalize_dependencies(addon, deps)
    keys = [d["key"] for d in datasets]
    assert len(keys) == len(set(keys)), "dataset duplicado"
    for d in datasets:
        for child in d["children"]:
            assert child["dataset"] in keys, child
    registry = {"contract": "nova.export.v1", "generated_from": "odoo_addons/*/nova_spec.py",
                "datasets": datasets, "dependencies": dependencies}
    schemas = {}
    for d in datasets:
        props = {"write_date": field_schema({"type": "datetime"})}
        for name, meta in d["fields"].items():
            props[name] = field_schema(meta)
        props["extra"] = {"type": "object", "maxProperties": 40}
        required = ["write_date"] + [n for n, m in d["fields"].items()
                                     if not m["optional"] and "pii" not in m["sensitivity"]]
        schemas[d["key"]] = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://nova.local/contracts/nova.export.v1/datasets/%s.schema.json" % d["key"],
            "title": "%s v%s (%s)" % (d["key"], d["version"], d["model"]),
            "type": "object", "additionalProperties": False, "properties": props, "required": required,
        }
    return registry, schemas


def fields_doc(registry):
    lines = ["# Inventario de campos exportados (contrato nova.export.v1)", "",
             "Generado por `python odoo_addons/tools/gen_contracts.py` desde los `nova_spec.py` de los addons.",
             "`id` y `write_date` son implícitos. **opt**: solo si existe en la instalación. **pii**: excluido salvo",
             "habilitación explícita por un administrador. **cost/price**: dato sensible exportado y etiquetado.",
             "Nunca se exportan contraseñas, tokens, binarios, adjuntos ni mensajes/chatter.", ""]
    for d in registry["datasets"]:
        lines += ["## `%s` v%s · `%s` (%s)" % (d["key"], d["version"], d["model"], d["addon"]), "",
                  "%s. Alcance compañía: `%s`. Modo: `%s`.%s" % (
                      d["description"], d["company_scope"], d["mode"],
                      " Hijos: " + ", ".join("`%s` por `%s`" % (c["dataset"], c["fk"]) for c in d["children"]) if d["children"] else ""),
                  "", "| Campo | Tipo | Opcional | Sensibilidad |", "|---|---|---|---|"]
        for name, meta in d["fields"].items():
            lines.append("| `%s` | %s | %s | %s |" % (name, meta["type"], "sí" if meta["optional"] else "", ", ".join(meta["sensitivity"])))
        lines.append("")
    lines += ["## Dependencias de captura", ""] + ["- `%s` (%s) → `%s`: %s" % (d["model"], ", ".join(d["fields"]), d["dataset"], d["description"])
                                                 for d in registry["dependencies"]]
    return "\n".join(lines) + "\n"


def dumps(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


def main():
    check = "--check" in sys.argv
    registry, schemas = build()
    outputs = {os.path.join(REPO, "contracts", "datasets.json"): dumps(registry),
               os.path.join(REPO, "docs", "FIELDS.md"): fields_doc(registry)}
    for key, schema in schemas.items():
        outputs[os.path.join(REPO, "contracts", "nova.export.v1", "datasets", key + ".schema.json")] = dumps(schema)
    stale = []
    for path, text in outputs.items():
        current = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if current != text:
            stale.append(os.path.relpath(path, REPO))
            if not check:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(text)
    if check and stale:
        print("Contratos desactualizados: %s" % ", ".join(stale))
        sys.exit(1)
    print("%s datasets, %s archivos %s" % (len(schemas), len(outputs), "verificados" if check else "escritos"))


if __name__ == "__main__":
    main()
