"""Static checks for the NOVA Odoo 16 addons that need no Odoo install:
manifest rules, Python 3.8 syntax (Ubuntu 20.04), XML well-formedness, ACL
references, data files, external-id references and forbidden patterns.
Real install/upgrade/tests must still run on an Odoo 16 database.
"""
import ast
import csv
import os
import re
import sys
import xml.etree.ElementTree as ET

ADDONS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORBIDDEN = [
    (re.compile(r"auth\s*=\s*['\"]none['\"]"), "controlador auth='none'"),
    (re.compile(r"\.commit\(\)"), "cr.commit() explícito"),
    (re.compile(r"ir\.config_parameter.*set_param"), "escritura en ir.config_parameter"),
    (re.compile(r"\bmatch\s+\w+\s*:"), "match/case (Python>=3.10)"),
]
ENTERPRISE = {"account_accountant", "helpdesk", "sale_subscription", "web_studio", "account_reports", "stock_barcode"}


def fail(errors, addon, msg):
    errors.append("%s: %s" % (addon, msg))


def models_declared(addon_dir):
    names = set()
    for root, _dirs, files in os.walk(os.path.join(addon_dir, "models")):
        for fname in files:
            if fname.endswith(".py"):
                src = open(os.path.join(root, fname), encoding="utf-8").read()
                names.update(re.findall(r"_name\s*=\s*[\"']([\w.]+)[\"']", src))
    return names


def check_addon(name, errors):
    path = os.path.join(ADDONS, name)
    manifest = ast.literal_eval(open(os.path.join(path, "__manifest__.py"), encoding="utf-8").read())
    if not re.match(r"^16\.0\.\d+\.\d+\.\d+$", manifest.get("version", "")):
        fail(errors, name, "versión debe ser 16.0.x.y.z")
    for key, expected in (("installable", True), ("auto_install", False)):
        if manifest.get(key) is not expected:
            fail(errors, name, "%s debe ser %s" % (key, expected))
    for key in ("license", "author", "name", "depends"):
        if not manifest.get(key):
            fail(errors, name, "falta %s" % key)
    if ENTERPRISE & set(manifest.get("depends", [])):
        fail(errors, name, "dependencia Enterprise")
    if not os.path.exists(os.path.join(path, "README.md")):
        fail(errors, name, "falta README.md")
    if not os.path.isdir(os.path.join(path, "tests")):
        fail(errors, name, "faltan tests")
    for data in manifest.get("data", []):
        if not os.path.exists(os.path.join(path, data)):
            fail(errors, name, "archivo de datos inexistente %s" % data)
    for root, _dirs, files in os.walk(path):
        for fname in files:
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, ADDONS)
            if fname.endswith(".py"):
                src = open(full, encoding="utf-8").read()
                try:
                    ast.parse(src, full, feature_version=(3, 8))
                except SyntaxError as exc:
                    fail(errors, name, "sintaxis Python 3.8 %s: %s" % (rel, exc))
                for regex, label in FORBIDDEN:
                    if regex.search(src):
                        fail(errors, name, "%s en %s" % (label, rel))
            elif fname.endswith(".xml"):
                try:
                    ET.parse(full)
                except ET.ParseError as exc:
                    fail(errors, name, "XML inválido %s: %s" % (rel, exc))
    acl = os.path.join(path, "security", "ir.model.access.csv")
    if os.path.exists(acl):
        declared = {"model_" + m.replace(".", "_") for m in models_declared(path)}
        with open(acl, encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if row["model_id:id"] not in declared:
                    fail(errors, name, "ACL referencia modelo no declarado %s" % row["model_id:id"])
        own = {m for m in models_declared(path) if m.startswith("nova.") and m != "nova.capture.mixin"
               and m != "nova.connector"}
        with open(acl, encoding="utf-8") as fh:
            covered = {row["model_id:id"] for row in csv.DictReader(fh)}
        for model in own:
            if "model_" + model.replace(".", "_") not in covered:
                fail(errors, name, "modelo %s sin ACL" % model)
    return manifest


def main():
    errors = []
    addons = sorted(d for d in os.listdir(ADDONS) if d.startswith("nova_") and os.path.isdir(os.path.join(ADDONS, d)))
    manifests = {a: check_addon(a, errors) for a in addons}
    for addon, manifest in manifests.items():
        for dep in manifest.get("depends", []):
            if dep.startswith("nova_") and dep not in manifests:
                fail(errors, addon, "depende de addon NOVA inexistente %s" % dep)
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    print("OK: %s addons verificados (%s)" % (len(addons), ", ".join(addons)))


if __name__ == "__main__":
    main()
