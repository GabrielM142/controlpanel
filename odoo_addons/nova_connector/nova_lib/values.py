"""Conversion of Odoo ``read(load=None)`` values into contract JSON values."""
from __future__ import annotations

import datetime as _dt
from decimal import Decimal, ROUND_HALF_UP


class ValueError_(ValueError):
    pass


def decimal_string(value, digits=None):
    """Return a canonical decimal string. Floats go through ``repr`` (shortest
    round-trip representation) so that 0.1 never becomes 0.1000000000000000055."""
    if value is None or value is False:
        return None
    if isinstance(value, bool):
        raise ValueError_("booleano no es decimal")
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError_("decimal no finito")
        dec = Decimal(repr(value))
    else:
        dec = Decimal(str(value))
    if digits is not None:
        dec = dec.quantize(Decimal(1).scaleb(-int(digits)), rounding=ROUND_HALF_UP)
    text = format(dec, "f")
    if text.startswith("-") and Decimal(text) == 0:
        text = text[1:]
    return text


def datetime_string(value):
    if not value:
        return None
    if isinstance(value, str):
        value = _dt.datetime.strptime(value[:19], "%Y-%m-%d %H:%M:%S")
    if value.tzinfo is not None:
        value = value.astimezone(_dt.timezone.utc).replace(tzinfo=None)
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def date_string(value):
    if not value:
        return None
    if isinstance(value, str):
        return value[:10]
    if isinstance(value, _dt.datetime):
        value = value.date()
    return value.isoformat()


def to_contract(value, ftype, digits=None):
    if ftype == "bool":
        return bool(value)
    if value is False or value is None:
        return [] if ftype == "m2m" else None
    if ftype in ("id", "int"):
        return int(value)
    if ftype == "m2o":
        if isinstance(value, (list, tuple)):
            value = value[0]
        return int(value)
    if ftype == "m2m":
        return sorted(int(v) for v in value)
    if ftype == "decimal":
        return decimal_string(value, digits)
    if ftype == "datetime":
        return datetime_string(value)
    if ftype == "date":
        return date_string(value)
    if ftype in ("string", "selection"):
        return str(value)
    raise ValueError_("tipo desconocido %s" % ftype)


def extra_value(value, ttype):
    """Custom (adapter) fields: many2one keeps id and display name."""
    if ttype == "many2one":
        if not value:
            return None
        if isinstance(value, (list, tuple)):
            return {"id": int(value[0]), "name": str(value[1]) if len(value) > 1 else None}
        return {"id": int(value), "name": None}
    if ttype == "boolean":
        return bool(value)
    if value is False or value is None:
        return None
    if ttype in ("integer",):
        return int(value)
    if ttype in ("float", "monetary"):
        return decimal_string(value)
    return str(value)
