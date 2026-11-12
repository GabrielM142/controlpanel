"""Build dist/nova_odoo16_addons.zip with each addon folder at the ZIP root.
Excludes caches, tests artifacts outside addons, env files and credentials.

    python odoo_addons/tools/package.py
"""
import os
import zipfile

ADDONS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(ADDONS)
OUT = os.path.join(REPO, "dist", "nova_odoo16_addons.zip")
SKIP_DIRS = {"__pycache__", ".pytest_cache", "node_modules"}
SKIP_FILES = (".pyc", ".pyo", ".env", ".log")


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for addon in sorted(os.listdir(ADDONS)):
            path = os.path.join(ADDONS, addon)
            if not (addon.startswith("nova_") and os.path.isfile(os.path.join(path, "__manifest__.py"))):
                continue
            for root, dirs, files in os.walk(path):
                dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
                for name in sorted(files):
                    if name.endswith(SKIP_FILES) or name.startswith(".env"):
                        continue
                    full = os.path.join(root, name)
                    zf.write(full, os.path.relpath(full, ADDONS).replace(os.sep, "/"))
                    count += 1
    print("%s (%s archivos)" % (os.path.relpath(OUT, REPO), count))


if __name__ == "__main__":
    main()
