"""Immutable part and manifest construction for contract ``nova.export.v1``.

A part is a UTF-8 JSON document. ``sha256`` and ``bytes`` are computed over
the *uncompressed* bytes; transport compresses with gzip (mtime=0) and base64.
Parts are limited by both row count and uncompressed size.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import json

PART_SCHEMA = "nova.export.part.v1"
MANIFEST_SCHEMA = "nova.export.v1"
HARD_MAX_RECORD_BYTES = 4 * 1024 * 1024
_ENVELOPE_OVERHEAD = 256


def canonical_bytes(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def gzip_bytes(data):
    return gzip.compress(data, compresslevel=6, mtime=0)


def encode_transport(content):
    return base64.b64encode(gzip_bytes(content)).decode("ascii")


class Part(object):
    __slots__ = ("part_no", "dataset", "records", "content", "sha256", "bytes")

    def __init__(self, part_no, dataset, records, content):
        self.part_no = part_no
        self.dataset = dataset
        self.records = records
        self.content = content
        self.sha256 = sha256_hex(content)
        self.bytes = len(content)

    def descriptor(self):
        return {"part_no": self.part_no, "dataset": self.dataset, "records": self.records,
                "bytes": self.bytes, "sha256": self.sha256, "encoding": "gzip+base64"}


class PartBuilder(object):
    """Accumulates encoded records for one dataset and emits immutable parts."""

    def __init__(self, run_uuid, dataset, dataset_version, max_rows, max_bytes,
                 next_part_no, next_seq):
        if max_rows < 1 or max_bytes < 1024:
            raise ValueError("límites de parte inválidos")
        self.run_uuid = run_uuid
        self.dataset = dataset
        self.dataset_version = dataset_version
        self.max_rows = max_rows
        self.max_bytes = max_bytes
        self.next_part_no = next_part_no
        self.next_seq = next_seq
        self._pending = []
        self._pending_bytes = _ENVELOPE_OVERHEAD
        self.parts = []

    def add(self, record):
        """``record``: dict with op/id/company_id/data|refs/reason. ``seq`` is assigned here."""
        record = dict(record)
        record["seq"] = self.next_seq
        size = len(canonical_bytes(record)) + 1
        if size > HARD_MAX_RECORD_BYTES:
            raise ValueError("registro %s/%s excede el máximo absoluto" % (self.dataset, record.get("id")))
        if self._pending and (len(self._pending) >= self.max_rows
                              or self._pending_bytes + size > self.max_bytes):
            self.flush()
        self._pending.append(record)
        self._pending_bytes += size
        self.next_seq += 1

    def flush(self):
        if not self._pending:
            return None
        doc = {"schema": PART_SCHEMA, "run_uuid": self.run_uuid, "part_no": self.next_part_no,
               "dataset": self.dataset, "dataset_version": self.dataset_version,
               "records": self._pending}
        part = Part(self.next_part_no, self.dataset, len(self._pending), canonical_bytes(doc))
        self.parts.append(part)
        self.next_part_no += 1
        self._pending = []
        self._pending_bytes = _ENVELOPE_OVERHEAD
        return part


def build_manifest(run, datasets, parts, reconciliation=(), warnings=()):
    """``run``: dict with run_uuid, run_seq, source, business_date, timezone,
    requested_cutoff_at, observed_from, observed_to, companies."""
    parts = sorted(parts, key=lambda p: p["part_no"])
    numbers = [p["part_no"] for p in parts]
    if numbers != list(range(1, len(parts) + 1)):
        raise ValueError("numeración de partes no contigua")
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "run_uuid": run["run_uuid"],
        "run_seq": int(run["run_seq"]),
        "source": run["source"],
        "business_date": run["business_date"],
        "timezone": run["timezone"],
        "requested_cutoff_at": run["requested_cutoff_at"],
        "observed_from": run["observed_from"],
        "observed_to": run["observed_to"],
        "consistency": "captured_interval",
        "companies": sorted(int(c) for c in run["companies"]),
        "datasets": sorted(datasets, key=lambda d: d["key"]),
        "parts": parts,
        "totals": {"parts": len(parts), "records": sum(p["records"] for p in parts),
                   "bytes": sum(p["bytes"] for p in parts)},
        "reconciliation": list(reconciliation),
        "warnings": list(warnings),
    }
    for ds in manifest["datasets"]:
        ds_parts = [p["part_no"] for p in parts if p["dataset"] == ds["key"]]
        if sorted(ds.get("parts", [])) != ds_parts:
            raise ValueError("partes del dataset %s inconsistentes" % ds["key"])
        if ds.get("records") != sum(p["records"] for p in parts if p["dataset"] == ds["key"]):
            raise ValueError("conteo del dataset %s inconsistente" % ds["key"])
    return manifest
