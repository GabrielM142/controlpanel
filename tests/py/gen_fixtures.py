"""Generate labelled FIXTURE batches (not client data) with the same library
the Odoo addon uses, so the Node worker is tested against Python-produced bytes.

Source "juj" (tenant A, companies 1 and 2) and source "beta" (tenant B) reuse the
same Odoo ids on purpose: keys must never be shared across databases.

    python tests/py/gen_fixtures.py          # write tests/fixtures/batches
    python tests/py/gen_fixtures.py --check  # verify committed fixtures
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "odoo_addons", "nova_connector"))

from nova_lib.batching import PartBuilder, build_manifest, encode_transport  # noqa: E402

OUT = os.path.join(REPO, "tests", "fixtures", "batches")
REGISTRY = json.load(open(os.path.join(REPO, "contracts", "datasets.json"), encoding="utf-8"))
SPECS = {d["key"]: d for d in REGISTRY["datasets"]}
WD = "2026-11-09T12:00:00Z"


def data(key, **values):
    spec = SPECS[key]
    out = {"write_date": values.pop("write_date", WD)}
    for name, meta in spec["fields"].items():
        if meta["optional"] or "pii" in meta["sensitivity"]:
            continue
        out[name] = False if meta["type"] == "bool" else ([] if meta["type"] == "m2m" else None)
    for name, value in values.items():
        if name != "extra" and name not in spec["fields"]:
            raise KeyError("%s.%s" % (key, name))
        out[name] = value
    return out


def up(key, rid, company, reason="backfill", **values):
    return (key, {"op": "upsert", "id": rid, "company_id": company, "data": data(key, **values), "reason": reason})


def rm(key, rid, company, refs, reason="deleted"):
    return (key, {"op": "delete", "id": rid, "company_id": company, "refs": refs, "reason": reason})


def aml(rid, move, company, account, balance, display, date, product=None, partner=None, residual="0.00",
        maturity=None, reason="backfill", journal=500, qty="1.00", reconciled=False):
    debit = balance if not balance.startswith("-") else "0.00"
    credit = balance[1:] if balance.startswith("-") else "0.00"
    return up("account_move_line", rid, company, reason, move_id=move, account_id=account, partner_id=partner,
              product_id=product, quantity=qty, balance=balance, debit=debit, credit=credit,
              amount_currency=balance, currency_id=1, company_id=company, date=date, date_maturity=maturity,
              display_type=display, amount_residual=residual, amount_residual_currency=residual,
              reconciled=reconciled, parent_state="posted", journal_id=journal,
              price_subtotal=(credit if display == "product" and credit != "0.00" else None))


def move(rid, company, mtype, date, partner, user, journal=500, reason="backfill", total="0.00"):
    return up("account_move", rid, company, reason, name="INV/%s" % rid, move_type=mtype, state="posted", date=date,
              invoice_date=date, invoice_date_due=date, partner_id=partner, commercial_partner_id=partner,
              invoice_user_id=user, journal_id=journal, company_id=company, currency_id=1,
              amount_untaxed_signed=total, amount_total_signed=total, amount_residual_signed=total,
              payment_state="not_paid")


def juj_run1():
    r = [
        up("res_company", 1, 1, name="JUJ Hogar (fixture)", currency_id=1, partner_id=1),
        up("res_company", 2, 2, name="JUJ Retail (fixture)", currency_id=1, partner_id=2),
        up("res_country_state", 10, None, name="Azuay", code="A", country_id=63),
        up("res_country_state", 11, None, name="Loja", code="L", country_id=63),
        up("res_users", 2, 1, name="Ana Vendedora", active=True, company_id=1),
        up("res_users", 3, 1, name="Luis Vendedor", active=True, company_id=1),
        up("product_category", 5, None, name="Ollas", complete_name="All / Ollas"),
        up("product_category", 6, None, name="Eléctricos", complete_name="All / Eléctricos"),
        up("product_template", 100, None, name="Olla 24cm", default_code="OL24", categ_id=5, type="product",
           sale_ok=True, purchase_ok=True, active=True, list_price="50.00", extra={"x_marca": "UMCO"}),
        up("product_template", 101, None, name="Licuadora", default_code="LIC1", categ_id=6, type="product",
           sale_ok=True, purchase_ok=True, active=True, list_price="80.00", extra={"x_marca": "Warenhaus"}),
        up("product_product", 200, None, product_tmpl_id=100, default_code="OL24", active=True),
        up("product_product", 201, None, product_tmpl_id=101, default_code="LIC1", active=True),
        up("res_partner", 300, None, name="Cliente A", is_company=True, commercial_partner_id=300, state_id=10,
           city="Cuenca", active=True),
        up("res_partner", 301, None, name="Cliente B", is_company=True, commercial_partner_id=301, state_id=11,
           city="Loja", active=True),
        up("account_account", 400, 1, code="1102", name="CxC", account_type="asset_receivable", company_id=1, reconcile=True),
        up("account_account", 401, 1, code="4101", name="Ventas", account_type="income", company_id=1),
        up("account_account", 402, 1, code="5101", name="Costo", account_type="expense_direct_cost", company_id=1),
        up("account_account", 403, 1, code="1104", name="Salida stock", account_type="asset_current", company_id=1),
        up("account_account", 410, 2, code="1102", name="CxC", account_type="asset_receivable", company_id=2, reconcile=True),
        up("account_journal", 500, 1, name="Facturas", code="INV", type="sale", company_id=1, active=True),
        up("account_journal", 501, 2, name="POS", code="POS", type="sale", company_id=2, active=True),
        # January invoice (will change in run 2: old document modified today)
        move(600, 1, "out_invoice", "2026-01-15", 300, 2, total="100.00"),
        aml(6001, 600, 1, 401, "-100.00", "product", "2026-01-15", product=200, partner=300, qty="2.00"),
        aml(6002, 600, 1, 400, "100.00", "payment_term", "2026-01-15", partner=300, residual="100.00", maturity="2026-02-14"),
        aml(6003, 600, 1, 402, "60.00", "cogs", "2026-01-15", product=200, partner=300),
        aml(6004, 600, 1, 403, "-60.00", "cogs", "2026-01-15", product=200, partner=300),
        # November invoice by Luis (salesperson changes to Ana in run 2)
        move(601, 1, "out_invoice", "2026-11-09", 301, 3, total="250.00"),
        aml(6011, 601, 1, 401, "-250.00", "product", "2026-11-09", product=201, partner=301),
        aml(6012, 601, 1, 400, "250.00", "payment_term", "2026-11-09", partner=301, residual="250.00", maturity="2026-11-09"),
        # Credit note: negative sale (its product line is deleted in run 2)
        move(602, 1, "out_refund", "2026-11-09", 300, 2, total="-20.00"),
        aml(6021, 602, 1, 401, "20.00", "product", "2026-11-09", product=200, partner=300),
        aml(6022, 602, 1, 400, "-20.00", "payment_term", "2026-11-09", partner=300, residual="-20.00", maturity="2026-11-09"),
        # Invoice generated from POS order 801 (POS order must not be counted again)
        move(603, 2, "out_invoice", "2026-11-09", 301, 3, journal=501, total="80.00"),
        aml(6031, 603, 2, 410, "-80.00", "product", "2026-11-09", product=201, partner=301, journal=501),
        aml(6032, 603, 2, 410, "80.00", "payment_term", "2026-11-09", partner=301, residual="0.00",
            maturity="2026-11-09", journal=501, reconciled=True),
        up("pos_config", 700, 2, name="Tienda Centro", company_id=2, active=True, journal_id=501),
        up("pos_order", 800, 2, name="POS/800", config_id=700, session_id=None, date_order="2026-11-09T14:00:00Z",
           partner_id=None, user_id=3, company_id=2, state="paid", amount_total="-35.00", amount_tax="0.00",
           amount_paid="-35.00", amount_return="0.00", account_move=None, currency_id=1),
        up("pos_order_line", 8001, 2, order_id=800, product_id=200, qty="1.00", price_unit="45.00", discount="0.00",
           price_subtotal="45.00", price_subtotal_incl="45.00", company_id=2, full_product_name="Olla 24cm"),
        up("pos_order_line", 8002, 2, order_id=800, product_id=201, qty="-1.00", price_unit="80.00", discount="0.00",
           price_subtotal="-80.00", price_subtotal_incl="-80.00", company_id=2, full_product_name="Licuadora (dev.)"),
        up("pos_order", 801, 2, name="POS/801", config_id=700, date_order="2026-11-09T15:00:00Z", partner_id=301,
           user_id=3, company_id=2, state="invoiced", amount_total="80.00", amount_tax="0.00", amount_paid="80.00",
           amount_return="0.00", account_move=603, currency_id=1),
        up("pos_order_line", 8011, 2, order_id=801, product_id=201, qty="1.00", price_unit="80.00", discount="0.00",
           price_subtotal="80.00", price_subtotal_incl="80.00", company_id=2, full_product_name="Licuadora"),
        up("stock_location", 900, 1, name="Stock", complete_name="WH/Stock", usage="internal", company_id=1, active=True),
        up("stock_location", 901, None, name="Customers", complete_name="Partners/Customers", usage="customer", active=True),
        up("stock_quant", 950, 1, product_id=200, location_id=900, quantity="40.00", reserved_quantity="0.00", company_id=1),
        up("stock_quant", 951, 1, product_id=201, location_id=901, quantity="12.00", reserved_quantity="0.00", company_id=1),
        up("stock_valuation_layer", 960, 1, product_id=200, company_id=1, quantity="40.00", unit_cost="30.00",
           value="1200.00", remaining_qty="40.00", remaining_value="1200.00", create_date="2026-10-01T10:00:00Z"),
        up("sale_order", 1000, 1, name="S1000", partner_id=300, date_order="2026-11-08T15:00:00Z", state="sale",
           user_id=2, company_id=1, currency_id=1, amount_untaxed="500.00", amount_total="500.00",
           invoice_status="to invoice"),
        up("sale_order_line", 1001, 1, order_id=1000, product_id=200, product_uom_qty="10.00", qty_delivered="6.00",
           qty_invoiced="4.00", qty_to_invoice="2.00", price_unit="50.00", discount="0.00", price_subtotal="500.00",
           price_total="500.00", company_id=1, currency_id=1, state="sale", salesman_id=2, order_partner_id=300),
    ]
    return r


def juj_run2():
    wd = "2026-11-10T16:00:00Z"
    return [
        # 1. Old (January) invoice changed today: 100 -> 130
        move(600, 1, "out_invoice", "2026-01-15", 300, 2, reason="event", total="130.00"),
        aml(6001, 600, 1, 401, "-130.00", "product", "2026-01-15", product=200, partner=300, qty="2.00", reason="event"),
        # 2. Salesperson change on 601: Luis -> Ana (old and new group must be corrected)
        move(601, 1, "out_invoice", "2026-11-09", 301, 2, reason="event", total="250.00"),
        # 3. Line deletion with prior refs
        rm("account_move_line", 6021, 1, {"move_id": 602, "company_id": 1, "account_id": 401, "product_id": 200,
                                          "date": "2026-11-09"}),
        # 4. Payment: partial reconciliation updates receivable line without header change
        up("account_partial_reconcile", 1100, 1, "event", debit_move_id=6002, credit_move_id=7001, amount="40.00",
           debit_amount_currency="40.00", credit_amount_currency="40.00", max_date="2026-11-10", company_id=1),
        aml(6002, 600, 1, 400, "100.00", "payment_term", "2026-01-15", partner=300, residual="60.00",
            maturity="2026-02-14", reason="event"),
        # 5. Product archived: history preserved, inactive state
        up("product_product", 201, None, "event", product_tmpl_id=101, default_code="LIC1", active=False, write_date=wd),
        # 6. Sale order deleted: lines removed centrally through declared cascade (no line events)
        rm("sale_order", 1000, 1, {"company_id": 1, "partner_id": 300, "user_id": 2, "date_order": "2026-11-08T15:00:00Z"}),
        # 7. New invoice on the new business day
        move(605, 1, "out_invoice", "2026-11-10", 300, 2, reason="event", total="75.00"),
        aml(6051, 605, 1, 401, "-75.00", "product", "2026-11-10", product=200, partner=300, reason="event"),
        aml(6052, 605, 1, 400, "75.00", "payment_term", "2026-11-10", partner=300, residual="75.00",
            maturity="2026-12-10", reason="event"),
        # 8. Quant moved by stock operation
        up("stock_quant", 950, 1, "event", product_id=200, location_id=900, quantity="38.00", reserved_quantity="0.00",
           company_id=1),
    ]


def beta_run1():
    return [
        up("res_company", 1, 1, name="Beta SA (fixture)", currency_id=1, partner_id=1),
        up("res_partner", 300, None, name="Beta Cliente", is_company=True, commercial_partner_id=300, active=True),
        up("product_template", 100, None, name="Producto Beta", categ_id=None, type="consu", sale_ok=True,
           purchase_ok=False, active=True, list_price="9.00"),
        up("product_product", 200, None, product_tmpl_id=100, active=True),
        up("account_account", 401, 1, code="4", name="Ventas", account_type="income", company_id=1),
        move(600, 1, "out_invoice", "2026-11-09", 300, None, total="999.00"),
        aml(6001, 600, 1, 401, "-999.00", "product", "2026-11-09", product=200, partner=300),
    ]


SOURCES = {
    "juj": {"installation_uuid": "6f1c1b6e-8d55-4a4b-a8f8-0b7f3c9c2a01", "companies": [1, 2],
            "runs": [("1b0e5a2a-0d0b-4bf0-9e1c-000000000101", "2026-11-09", juj_run1, True),
                     ("1b0e5a2a-0d0b-4bf0-9e1c-000000000102", "2026-11-10", juj_run2, True),
                     ("1b0e5a2a-0d0b-4bf0-9e1c-000000000103", "2026-11-11", lambda: [], True)]},
    "beta": {"installation_uuid": "0a9d4a0e-55a2-4c3d-9d77-7e2b3f9e0b02", "companies": [1],
             "runs": [("2c4f7a1b-3e0b-4f2a-8f1d-000000000201", "2026-11-09", beta_run1, True)]},
}


def build_run(source, idx, run_uuid, business_date, rows):
    by_ds = {}
    for key, rec in rows:
        by_ds.setdefault(key, []).append(rec)
    next_part, next_seq = 1, 1
    parts, descs, datasets = [], [], []
    for key in sorted(by_ds):
        b = PartBuilder(run_uuid, key, SPECS[key]["version"], 4, 64 * 1024, next_part, next_seq)
        for rec in by_ds[key]:
            b.add(rec)
        b.flush()
        next_part, next_seq = b.next_part_no, b.next_seq
        for p in b.parts:
            parts.append(p)
            descs.append(p.descriptor())
        datasets.append({"key": key, "version": SPECS[key]["version"], "mode": "delta",
                         "records": sum(p.records for p in b.parts), "parts": [p.part_no for p in b.parts],
                         "events": sum(1 for r in by_ds[key] if r["reason"] == "event"),
                         "backfill_complete": True, "resync_epoch": 1, "missing_optional_fields": [],
                         "complete": True})
    y, m, d = business_date.split("-")
    nxt = "%s-%s-%02dT05:00:00Z" % (y, m, int(d) + 1)
    manifest = build_manifest({
        "run_uuid": run_uuid, "run_seq": idx,
        "source": {"installation_uuid": SOURCES[source]["installation_uuid"], "generation": 1,
                   "odoo_version": "16.0", "connector_version": "16.0.1.0.0"},
        "business_date": business_date, "timezone": "America/Guayaquil", "requested_cutoff_at": nxt,
        "observed_from": nxt.replace("05:00:00", "05:00:07"), "observed_to": nxt.replace("05:00:00", "05:03:41"),
        "companies": SOURCES[source]["companies"],
    }, datasets, descs, [], [{"code": "fixture", "detail": "Datos de prueba etiquetados, no cliente real"}])
    files = {"manifest.json": manifest}
    for p in parts:
        files["part-%05d.json" % p.part_no] = {"run_uuid": run_uuid, "part_no": p.part_no, "dataset": p.dataset,
                                               "encoding": "gzip+base64", "sha256": p.sha256, "bytes": p.bytes,
                                               "records": p.records, "content": encode_transport(p.content)}
    return files


def outputs():
    out = {}
    for source, cfg in SOURCES.items():
        out[os.path.join(source, "capabilities.json")] = {
            "installation_uuid": cfg["installation_uuid"], "generation": 1, "state": "linked",
            "odoo_version": "16.0", "connector_version": "16.0.1.0.0", "contract": "nova.export.v1",
            "timezone": "America/Guayaquil", "companies": [{"id": c, "name": "Compañía %s (fixture)" % c,
                                                            "currency": "USD"} for c in cfg["companies"]],
            "datasets": [], "attribute_map": [{"attribute": "brand", "dataset": "product_template",
                                               "field": "x_marca", "ttype": "char", "relation": None,
                                               "adapter": "nova_juj"}] if source == "juj" else []}
        for idx, (run_uuid, bdate, fn, _ok) in enumerate(cfg["runs"], start=1):
            for name, doc in build_run(source, idx, run_uuid, bdate, fn()).items():
                out[os.path.join(source, "run-%03d" % idx, name)] = doc
    return {k: json.dumps(v, indent=1, ensure_ascii=False, sort_keys=True) + "\n" for k, v in out.items()}


def _normalized(text):
    """Compare decompressed content: gzip bytes may legitimately differ across zlib builds."""
    import base64
    import gzip
    doc = json.loads(text)
    if isinstance(doc, dict) and doc.get("encoding") == "gzip+base64":
        doc["content"] = gzip.decompress(base64.b64decode(doc["content"])).decode("utf-8")
    return doc


def main():
    check = "--check" in sys.argv
    stale = []
    for rel, text in outputs().items():
        path = os.path.join(OUT, rel)
        current = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if current is None or (current != text and (not check or _normalized(current) != _normalized(text))):
            stale.append(rel)
            if not check:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(text)
    if check and stale:
        print("Fixtures desactualizados: %s" % ", ".join(stale))
        sys.exit(1)
    print("fixtures %s" % ("verificados" if check else "escritos (%s cambios)" % len(stale)))


if __name__ == "__main__":
    main()
