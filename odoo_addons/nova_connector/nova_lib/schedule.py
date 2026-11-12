"""Night window computation. A run prepared during the night of day D+1
analyses ``business_date`` D and requests the cutoff at local midnight D+1.
The requested cutoff is *not* a consistent snapshot: the manifest also records
the real observation interval."""
from __future__ import annotations

import datetime as _dt


def _localize(tz, naive):
    if hasattr(tz, "localize"):  # pytz
        return tz.localize(naive)
    return naive.replace(tzinfo=tz)


def night_window(now_utc, tz, start_hour=0, end_hour=6):
    """Return dict(in_window, business_date, requested_cutoff_at, local_now)."""
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=_dt.timezone.utc)
    if not (0 <= start_hour <= 23 and 1 <= end_hour <= 24 and start_hour < end_hour):
        raise ValueError("ventana inválida")
    local_now = now_utc.astimezone(tz)
    today = local_now.date()
    business_date = today - _dt.timedelta(days=1)
    cutoff_local = _localize(tz, _dt.datetime(today.year, today.month, today.day))
    cutoff_utc = cutoff_local.astimezone(_dt.timezone.utc)
    in_window = start_hour <= local_now.hour < end_hour
    return {
        "in_window": in_window,
        "business_date": business_date.isoformat(),
        "requested_cutoff_at": cutoff_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "local_now": local_now,
    }


def utc_iso(value):
    if value.tzinfo is not None:
        value = value.astimezone(_dt.timezone.utc).replace(tzinfo=None)
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")
