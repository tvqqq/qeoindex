#!/usr/bin/env python3
"""Bounded, read-only SSI FastConnect VHM RAW-basis probe for QEO-135.

This script never persists provider data. It calls only three pinned VHM Daily
ranges and emits sanitized JSON evidence. Missing credentials cause a clean
skip before importing the SSI SDK.
"""

from __future__ import annotations

from datetime import datetime
import importlib.metadata
import json
import math
import os
import sys
from typing import Any, Callable, Mapping

CREDENTIAL_KEYS = ("SSI_CLIENT_ID", "SSI_API_KEY", "SSI_API_SECRET")
PROVIDER = "SSI_FASTCONNECT_V3"
SDK_PACKAGE = "ssi-sdk"
SDK_PIN = "3.2.1"
SYMBOL = "VHM"
PAGE = 1
PAGE_SIZE = 100

ANCHOR_RANGES = (
    ("2025/10/13", "2025/10/17"),
    ("2026/06/26", "2026/06/26"),
    ("2026/08/05", "2026/08/05"),
)

PRICE_TOLERANCE = 0.051
PRICE_SCALE_CANDIDATES = (1, 1000)


def credential_state(env: Mapping[str, str]) -> dict[str, Any]:
    missing = [key for key in CREDENTIAL_KEYS if not env.get(key, "").strip()]
    return {"configured": not missing, "missing_credentials": missing}


def _number(value: Any) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("non-finite numeric provider value")
    return number


def normalize_session_date(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("missing trading date")

    compact = text[:10]
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(compact, fmt).date().isoformat()
        except ValueError:
            continue

    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError as exc:
        raise ValueError(f"unsupported trading date format: {text[:32]}") from exc


def normalize_provider_bar(bar: Any) -> dict[str, Any]:
    if isinstance(bar, Mapping):
        get = bar.get
        trading_date = get("session_date", get("trading_date", get("tradingDate", "")))
        open_price = get("open", get("open_price", 0))
        high_price = get("high", get("high_price", 0))
        low_price = get("low", get("low_price", 0))
        close_price = get("close", get("close_price", 0))
        volume = get("volume", 0)
    else:
        trading_date = getattr(bar, "trading_date")
        open_price = getattr(bar, "open_price")
        high_price = getattr(bar, "high_price")
        low_price = getattr(bar, "low_price")
        close_price = getattr(bar, "close_price")
        volume = getattr(bar, "volume")

    row = {
        "session_date": normalize_session_date(trading_date),
        "open": _number(open_price),
        "high": _number(high_price),
        "low": _number(low_price),
        "close": _number(close_price),
        "volume": int(volume),
    }
    if row["open"] <= 0 or row["high"] <= 0 or row["low"] <= 0 or row["close"] <= 0:
        raise ValueError(f"non-positive OHLC for {row['session_date']}")
    if row["volume"] < 0:
        raise ValueError(f"negative volume for {row['session_date']}")
    if row["high"] < max(row["open"], row["close"], row["low"]):
        raise ValueError(f"invalid high for {row['session_date']}")
    if row["low"] > min(row["open"], row["close"], row["high"]):
        raise ValueError(f"invalid low for {row['session_date']}")
    return row


def collect_anchor_rows(
    fetch_daily: Callable[[str, str, str, int, int], list[Any]],
) -> list[dict[str, Any]]:
    rows_by_session: dict[str, dict[str, Any]] = {}
    for from_date, to_date in ANCHOR_RANGES:
        provider_rows = fetch_daily(SYMBOL, from_date, to_date, PAGE, PAGE_SIZE)
        for provider_row in provider_rows:
            row = normalize_provider_bar(provider_row)
            session = row["session_date"]
            existing = rows_by_session.get(session)
            if existing is not None and existing != row:
                raise ValueError(f"conflicting duplicate provider session: {session}")
            rows_by_session[session] = row
    return [rows_by_session[key] for key in sorted(rows_by_session)]


def _close_enough(actual: float, expected: float) -> bool:
    return abs(actual - expected) <= PRICE_TOLERANCE


def _scaled(row: Mapping[str, Any], divisor: int, field: str) -> float:
    return _number(row[field]) / divisor


def _assess_for_scale(rows_by_session: Mapping[str, Mapping[str, Any]], divisor: int) -> dict[str, Any]:
    week_rows = [
        row
        for session, row in rows_by_session.items()
        if "2025-10-13" <= session <= "2025-10-17"
    ]
    week_match = False
    week_observed: dict[str, Any] = {"sessions": len(week_rows)}
    if week_rows:
        observed_high = max(_scaled(row, divisor, "high") for row in week_rows)
        observed_low = min(_scaled(row, divisor, "low") for row in week_rows)
        week_observed.update({"high": observed_high, "low": observed_low})
        week_match = _close_enough(observed_high, 131.5) and _close_enough(observed_low, 114.6)

    exact_specs = {
        "2026-06-26": {"open": 157.5, "high": 163.9, "low": 156.5, "close": 162.0},
        "2026-08-05": {"open": 154.2, "high": 158.8, "low": 153.0, "close": 153.0},
    }
    exact_results: dict[str, Any] = {}
    exact_matches = 0
    for session, expected in exact_specs.items():
        row = rows_by_session.get(session)
        matched = False
        observed = None
        if row is not None:
            observed = {field: _scaled(row, divisor, field) for field in expected}
            matched = all(_close_enough(observed[field], target) for field, target in expected.items())
        if matched:
            exact_matches += 1
        exact_results[session] = {"matched": matched, "observed": observed, "expected": expected}

    anchors_matched = int(week_match) + exact_matches
    return {
        "divisor": divisor,
        "anchors_matched": anchors_matched,
        "week_2025_10_13_17": {
            "matched": week_match,
            "observed": week_observed,
            "expected": {"high": 131.5, "low": 114.6},
        },
        "exact_sessions": exact_results,
    }


def assess_raw_basis(rows: list[Mapping[str, Any]]) -> dict[str, Any]:
    rows_by_session: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        session = normalize_session_date(row.get("session_date"))
        if session in rows_by_session:
            return {
                "status": "RAW_ANCHOR_MISMATCH",
                "price_scale_divisor": None,
                "anchors_matched": 0,
                "reason": f"duplicate session {session}",
                "scale_candidates": [],
            }
        rows_by_session[session] = row

    candidates = [_assess_for_scale(rows_by_session, divisor) for divisor in PRICE_SCALE_CANDIDATES]
    best = max(candidates, key=lambda item: item["anchors_matched"], default=None)
    if best is not None and best["anchors_matched"] == 3:
        return {
            "status": "RAW_ANCHOR_MATCH",
            "price_scale_divisor": best["divisor"],
            "anchors_matched": 3,
            "reason": "provider OHLC independently matches all pinned VHM RAW anchors",
            "scale_candidates": candidates,
        }

    return {
        "status": "RAW_ANCHOR_MISMATCH",
        "price_scale_divisor": None,
        "anchors_matched": best["anchors_matched"] if best else 0,
        "reason": "provider OHLC does not match all pinned VHM RAW anchors at allowed unit scales",
        "scale_candidates": candidates,
    }


def redact_text(value: Any, env: Mapping[str, str]) -> str:
    text = str(value)
    for key in CREDENTIAL_KEYS:
        secret_value = env.get(key, "")
        if secret_value:
            text = text.replace(secret_value, "[REDACTED]")
    return text[:1000]


def _live_probe(env: Mapping[str, str]) -> dict[str, Any]:
    # Import only after credential_state has already established all required
    # credentials. This keeps the no-secret path dependency- and network-free.
    from ssi_sdk import Auth, Config, Data  # type: ignore[import-not-found]

    config = Config(
        client_id=env["SSI_CLIENT_ID"],
        api_key=env["SSI_API_KEY"],
        api_secret=env["SSI_API_SECRET"],
        timeout=20,
        max_retries=2,
        retry_delay=1.0,
        rate_limit_per_second=2,
        log_level="CRITICAL",
    )

    with Auth(config) as auth:
        auth.authenticate()
        with Data(auth) as data:
            rows = collect_anchor_rows(data.market_data.get_ohlc_1day_historical)

    assessment = assess_raw_basis(rows)
    divisor = assessment["price_scale_divisor"]
    evidence_rows = []
    for row in rows:
        item = dict(row)
        if divisor:
            item["normalized_price_unit"] = "THOUSAND_VND"
            item["normalized_open"] = row["open"] / divisor
            item["normalized_high"] = row["high"] / divisor
            item["normalized_low"] = row["low"] / divisor
            item["normalized_close"] = row["close"] / divisor
        evidence_rows.append(item)

    return {
        "provider_call": "completed",
        "sdk_version": importlib.metadata.version(SDK_PACKAGE),
        "endpoint_contract": "/api/v3/data/ohlc",
        "requested_ranges": [
            {"symbol": SYMBOL, "from": start, "to": end, "page": PAGE, "size": PAGE_SIZE}
            for start, end in ANCHOR_RANGES
        ],
        "returned_rows": len(rows),
        "rows": evidence_rows,
        "raw_basis_assessment": assessment,
        "limitations": [
            "FastConnect v3 OHLCData exposes OHLCV but not a separate adjusted-close field in the official SDK model.",
            "This probe establishes technical RAW-basis evidence only; retained-storage/use rights remain a separate QEO-135 gate.",
            "No production persistence is performed by this probe.",
        ],
    }


def build_output(env: Mapping[str, str]) -> dict[str, Any]:
    state = credential_state(env)
    base: dict[str, Any] = {
        "qeo": "QEO-135",
        "provider": PROVIDER,
        "sdk_pin": SDK_PIN,
        **state,
    }
    if not state["configured"]:
        return {
            **base,
            "provider_call": "skipped",
            "status": "NOT_CONFIGURED",
            "note": "Configure SSI_CLIENT_ID, SSI_API_KEY and SSI_API_SECRET to run the bounded credentialed probe.",
        }

    try:
        return {**base, **_live_probe(env), "status": "EVIDENCE_CAPTURED"}
    except ModuleNotFoundError as exc:
        return {
            **base,
            "provider_call": "failed",
            "status": "SDK_NOT_INSTALLED",
            "error_class": type(exc).__name__,
            "error": redact_text(exc, env),
        }
    except Exception as exc:  # bounded evidence capture; preserve sanitized failure class
        return {
            **base,
            "provider_call": "failed",
            "status": "PROVIDER_ERROR",
            "error_class": type(exc).__name__,
            "error": redact_text(exc, env),
        }


def ci_exit_code(output: Mapping[str, Any]) -> int:
    if not output.get("configured"):
        return 0
    if output.get("provider_call") != "completed":
        return 2
    assessment = output.get("raw_basis_assessment")
    if not isinstance(assessment, Mapping) or assessment.get("status") != "RAW_ANCHOR_MATCH":
        return 3
    return 0


def main() -> int:
    output = build_output(os.environ)
    json.dump(output, sys.stdout, ensure_ascii=False, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return ci_exit_code(output)


if __name__ == "__main__":
    raise SystemExit(main())
