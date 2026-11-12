"""Pure-Python tests of the connector library (no Odoo needed).

    python -m unittest discover -s tests/py -v
"""
import base64
import datetime as dt
import gzip
import hashlib
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "odoo_addons", "nova_connector"))

from nova_lib import batching, schedule, spec, values  # noqa: E402

try:
    import pytz
except ImportError:  # pragma: no cover
    pytz = None


class ValuesTest(unittest.TestCase):
    def test_decimal_strings_are_exact(self):
        self.assertEqual(values.decimal_string(0.1), "0.1")
        self.assertEqual(values.decimal_string(0.1 + 0.2, 2), "0.30")
        self.assertEqual(values.decimal_string(-0.0, 2), "0.00")
        self.assertEqual(values.decimal_string(-1234.565, 2), "-1234.57")
        self.assertEqual(values.decimal_string(10), "10")
        self.assertIsNone(values.decimal_string(False))
        with self.assertRaises(ValueError):
            values.decimal_string(float("nan"))

    def test_types(self):
        self.assertEqual(values.to_contract(False, "m2o"), None)
        self.assertEqual(values.to_contract((5, "x"), "m2o"), 5)
        self.assertEqual(values.to_contract([3, 1], "m2m"), [1, 3])
        self.assertEqual(values.to_contract(False, "m2m"), [])
        self.assertIs(values.to_contract(False, "bool"), False)
        self.assertEqual(values.to_contract(dt.datetime(2026, 1, 2, 3, 4, 5), "datetime"), "2026-01-02T03:04:05Z")
        self.assertEqual(values.to_contract(dt.date(2026, 1, 2), "date"), "2026-01-02")
        self.assertEqual(values.extra_value((7, "UMCO"), "many2one"), {"id": 7, "name": "UMCO"})


class BatchingTest(unittest.TestCase):
    def _builder(self, rows=3, size=2048):
        return batching.PartBuilder("8c7d2c8e-6d0c-4b52-9a33-3f1d1b8b0c11", "res_partner", 1, rows, size, 1, 1)

    def test_row_limit_and_sequence(self):
        b = self._builder(rows=3)
        for i in range(1, 8):
            b.add({"op": "upsert", "id": i, "company_id": 1, "data": {"name": "p%s" % i}, "reason": "backfill"})
        b.flush()
        self.assertEqual([p.records for p in b.parts], [3, 3, 1])
        self.assertEqual([p.part_no for p in b.parts], [1, 2, 3])
        seqs = [r["seq"] for p in b.parts for r in json.loads(p.content)["records"]]
        self.assertEqual(seqs, list(range(1, 8)))

    def test_byte_limit(self):
        b = self._builder(rows=1000, size=1024)
        for i in range(1, 30):
            b.add({"op": "upsert", "id": i, "company_id": 1, "data": {"name": "x" * 100}, "reason": "event"})
        b.flush()
        self.assertGreater(len(b.parts), 1)
        for p in b.parts[:-1]:
            self.assertLessEqual(p.bytes, 1024 + 256)

    def test_checksum_over_uncompressed_bytes_and_transport(self):
        b = self._builder()
        b.add({"op": "delete", "id": 9, "company_id": 1, "refs": {"company_id": 1}, "reason": "deleted"})
        part = b.flush()
        self.assertEqual(part.sha256, hashlib.sha256(part.content).hexdigest())
        transported = batching.encode_transport(part.content)
        self.assertEqual(gzip.decompress(base64.b64decode(transported)), part.content)
        self.assertEqual(batching.gzip_bytes(part.content), batching.gzip_bytes(part.content))  # mtime=0

    def test_manifest_validation(self):
        b = self._builder(rows=2)
        for i in range(1, 4):
            b.add({"op": "upsert", "id": i, "company_id": 1, "data": {}, "reason": "event"})
        b.flush()
        descs = [p.descriptor() for p in b.parts]
        run = {"run_uuid": b.run_uuid, "run_seq": 1, "source": {}, "business_date": "2026-11-10",
               "timezone": "America/Guayaquil", "requested_cutoff_at": "2026-11-11T05:00:00Z",
               "observed_from": "2026-11-11T05:01:00Z", "observed_to": "2026-11-11T05:02:00Z", "companies": [1]}
        ds = [{"key": "res_partner", "version": 1, "mode": "delta", "records": 3, "parts": [1, 2]}]
        manifest = batching.build_manifest(run, ds, descs)
        self.assertEqual(manifest["totals"]["records"], 3)
        with self.assertRaises(ValueError):
            batching.build_manifest(run, [dict(ds[0], records=4)], descs)
        with self.assertRaises(ValueError):
            batching.build_manifest(run, ds, descs[1:])


@unittest.skipIf(pytz is None, "pytz no disponible")
class ScheduleTest(unittest.TestCase):
    def test_business_date_and_cutoff_in_client_timezone(self):
        tz = pytz.timezone("America/Guayaquil")  # UTC-5, no DST
        w = schedule.night_window(dt.datetime(2026, 11, 11, 5, 30), tz, 0, 6)  # 00:30 local
        self.assertTrue(w["in_window"])
        self.assertEqual(w["business_date"], "2026-11-10")
        self.assertEqual(w["requested_cutoff_at"], "2026-11-11T05:00:00Z")
        late = schedule.night_window(dt.datetime(2026, 11, 11, 12, 0), tz, 0, 6)
        self.assertFalse(late["in_window"])

    def test_day_change_dst_timezone(self):
        tz = pytz.timezone("America/New_York")
        w = schedule.night_window(dt.datetime(2026, 3, 8, 6, 30), tz, 0, 6)  # DST starts that night
        self.assertEqual(w["business_date"], "2026-03-07")
        self.assertEqual(w["requested_cutoff_at"], "2026-03-08T05:00:00Z")


class SpecTest(unittest.TestCase):
    def test_rejects_invalid_declarations(self):
        with self.assertRaises(spec.SpecError):
            spec.normalize_dataset("x", {"key": "a", "version": 1, "model": "a", "company_scope": "strict",
                                         "fields": {"id": "id"}})
        with self.assertRaises(spec.SpecError):
            spec.parse_field("blob")
        with self.assertRaises(spec.SpecError):
            spec.normalize_dataset("x", {"key": "a", "version": 1, "model": "a", "company_scope": "strict",
                                         "fields": {"n": "string"}, "capture": {"refs": ["zz"]}})

    def test_pii_excluded_and_optional_missing(self):
        d = spec.normalize_dataset("x", {"key": "p", "version": 1, "model": "res.partner", "company_scope": "shared",
                                         "fields": {"name": "string", "email": "string,pii", "ref": "string,opt"}})
        read, req, opt = spec.exported_fields(d, {"name", "email"})
        self.assertEqual(read, ["name"])
        self.assertEqual(opt, ["ref"])
        self.assertEqual(req, [])
        read, _r, _o = spec.exported_fields(d, {"name", "email"}, {"email"})
        self.assertEqual(read, ["name", "email"])


class ContractsUpToDateTest(unittest.TestCase):
    def test_generated_contracts_match_specs(self):
        out = subprocess.run([sys.executable, os.path.join(REPO, "odoo_addons", "tools", "gen_contracts.py"), "--check"],
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)

    def test_static_addon_checks(self):
        out = subprocess.run([sys.executable, os.path.join(REPO, "odoo_addons", "tools", "check_addons.py")],
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)

    def test_fixtures_are_reproducible(self):
        out = subprocess.run([sys.executable, os.path.join(HERE, "gen_fixtures.py"), "--check"],
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)


if __name__ == "__main__":
    unittest.main()
