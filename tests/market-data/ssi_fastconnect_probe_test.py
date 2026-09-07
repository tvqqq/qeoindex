from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "market" / "ssi_fastconnect_vhm_probe.py"


def load_probe_module():
    if not SCRIPT.exists():
        raise AssertionError(f"probe implementation missing: {SCRIPT}")
    spec = importlib.util.spec_from_file_location("ssi_fastconnect_vhm_probe", SCRIPT)
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load probe module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def canonical_raw_rows(scale: int = 1):
    return [
        {"session_date": "2025-10-13", "open": 123 * scale, "high": 126 * scale, "low": 122.1 * scale, "close": 124.2 * scale, "volume": 13_782_200},
        {"session_date": "2025-10-14", "open": 124.5 * scale, "high": 131.5 * scale, "low": 124.5 * scale, "close": 127 * scale, "volume": 14_600_200},
        {"session_date": "2025-10-15", "open": 127.5 * scale, "high": 127.6 * scale, "low": 122.6 * scale, "close": 124 * scale, "volume": 8_062_500},
        {"session_date": "2025-10-16", "open": 123.8 * scale, "high": 123.8 * scale, "low": 120.4 * scale, "close": 122 * scale, "volume": 9_614_900},
        {"session_date": "2025-10-17", "open": 122 * scale, "high": 122 * scale, "low": 114.6 * scale, "close": 116 * scale, "volume": 12_213_500},
        {"session_date": "2026-06-26", "open": 157.5 * scale, "high": 163.9 * scale, "low": 156.5 * scale, "close": 162 * scale, "volume": 12_073_300},
        {"session_date": "2026-08-05", "open": 154.2 * scale, "high": 158.8 * scale, "low": 153 * scale, "close": 153 * scale, "volume": 10_681_100},
    ]


class SsiFastConnectProbeTest(unittest.TestCase):
    def test_missing_credentials_skips_sdk_and_network_with_sanitized_json(self):
        env = os.environ.copy()
        env.pop("SSI_CLIENT_ID", None)
        env.pop("SSI_API_KEY", None)
        env.pop("SSI_API_SECRET", None)
        env["PYTHONPATH"] = "/definitely/not/ssi-sdk"

        result = subprocess.run(
            [sys.executable, str(SCRIPT)],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["configured"])
        self.assertEqual(
            payload["missing_credentials"],
            ["SSI_CLIENT_ID", "SSI_API_KEY", "SSI_API_SECRET"],
        )
        self.assertEqual(payload["provider_call"], "skipped")

    def test_credential_state_never_returns_credential_values(self):
        probe = load_probe_module()
        state = probe.credential_state(
            {
                "SSI_CLIENT_ID": "client-value-qeo135",
                "SSI_API_KEY": "api-key-value-qeo135",
                "SSI_API_SECRET": "api-secret-value-qeo135",
            }
        )

        encoded = json.dumps(state, sort_keys=True)
        self.assertEqual(state, {"configured": True, "missing_credentials": []})
        self.assertNotIn("client-value-qeo135", encoded)
        self.assertNotIn("api-key-value-qeo135", encoded)
        self.assertNotIn("api-secret-value-qeo135", encoded)

    def test_raw_anchor_classifier_accepts_exact_canonical_rows_in_thousand_vnd(self):
        probe = load_probe_module()
        assessment = probe.assess_raw_basis(canonical_raw_rows())

        self.assertEqual(assessment["status"], "RAW_ANCHOR_MATCH")
        self.assertEqual(assessment["price_scale_divisor"], 1)
        self.assertEqual(assessment["anchors_matched"], 3)
        self.assertEqual(assessment["sessions_matched"], 7)

    def test_raw_anchor_classifier_accepts_exact_canonical_rows_in_vnd(self):
        probe = load_probe_module()
        assessment = probe.assess_raw_basis(canonical_raw_rows(1000))

        self.assertEqual(assessment["status"], "RAW_ANCHOR_MATCH")
        self.assertEqual(assessment["price_scale_divisor"], 1000)
        self.assertEqual(assessment["anchors_matched"], 3)
        self.assertEqual(assessment["sessions_matched"], 7)

    def test_week_session_ohlc_mismatch_fails_even_when_weekly_high_low_still_match(self):
        probe = load_probe_module()
        rows = canonical_raw_rows()
        rows[0] = {**rows[0], "close": 125.2}

        assessment = probe.assess_raw_basis(rows)

        self.assertEqual(assessment["status"], "RAW_ANCHOR_MISMATCH")
        self.assertIsNone(assessment["price_scale_divisor"])
        self.assertLess(assessment["sessions_matched"], 7)

    def test_adjusted_like_prices_are_rejected_as_raw(self):
        probe = load_probe_module()
        rows = [
            {"session_date": "2025-10-13", "open": 59.3, "high": 60.7, "low": 58.84, "close": 59.8, "volume": 13_782_200},
            {"session_date": "2025-10-14", "open": 60.0, "high": 63.31, "low": 60.0, "close": 61.15, "volume": 14_600_200},
            {"session_date": "2025-10-15", "open": 61.4, "high": 61.45, "low": 59.0, "close": 59.7, "volume": 8_062_500},
            {"session_date": "2025-10-16", "open": 59.6, "high": 59.6, "low": 58.0, "close": 58.74, "volume": 9_614_900},
            {"session_date": "2025-10-17", "open": 58.7, "high": 58.7, "low": 55.18, "close": 55.85, "volume": 12_213_500},
            {"session_date": "2026-06-26", "open": 78.75, "high": 81.95, "low": 78.25, "close": 78.0, "volume": 12_073_300},
            {"session_date": "2026-08-05", "open": 77.1, "high": 79.4, "low": 76.5, "close": 76.5, "volume": 10_681_100},
        ]

        assessment = probe.assess_raw_basis(rows)

        self.assertEqual(assessment["status"], "RAW_ANCHOR_MISMATCH")
        self.assertIsNone(assessment["price_scale_divisor"])
        self.assertLess(assessment["anchors_matched"], 3)

    def test_probe_requests_only_three_bounded_ranges(self):
        probe = load_probe_module()
        calls = []

        def fake_fetch(symbol, from_date, to_date, page, size):
            calls.append((symbol, from_date, to_date, page, size))
            return []

        probe.collect_anchor_rows(fake_fetch)

        self.assertEqual(
            calls,
            [
                ("VHM", "2025/10/13", "2025/10/17", 1, 100),
                ("VHM", "2026/06/26", "2026/06/26", 1, 100),
                ("VHM", "2026/08/05", "2026/08/05", 1, 100),
            ],
        )

    def test_ci_exit_code_is_fail_closed_only_when_live_probe_is_configured(self):
        probe = load_probe_module()

        self.assertEqual(
            probe.ci_exit_code({"configured": False, "provider_call": "skipped"}),
            0,
        )
        self.assertNotEqual(
            probe.ci_exit_code({"configured": True, "provider_call": "failed"}),
            0,
        )
        self.assertNotEqual(
            probe.ci_exit_code(
                {
                    "configured": True,
                    "provider_call": "completed",
                    "raw_basis_assessment": {"status": "RAW_ANCHOR_MISMATCH"},
                }
            ),
            0,
        )
        self.assertEqual(
            probe.ci_exit_code(
                {
                    "configured": True,
                    "provider_call": "completed",
                    "raw_basis_assessment": {"status": "RAW_ANCHOR_MATCH"},
                }
            ),
            0,
        )


if __name__ == "__main__":
    unittest.main()
