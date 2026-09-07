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

    def test_raw_anchor_classifier_accepts_provider_prices_in_thousand_vnd(self):
        probe = load_probe_module()
        rows = [
            {"session_date": "2025-10-13", "open": 120.0, "high": 125.0, "low": 114.6, "close": 122.0, "volume": 10},
            {"session_date": "2025-10-14", "open": 123.0, "high": 131.5, "low": 120.0, "close": 130.0, "volume": 11},
            {"session_date": "2025-10-15", "open": 129.0, "high": 130.0, "low": 121.0, "close": 124.0, "volume": 12},
            {"session_date": "2025-10-16", "open": 124.0, "high": 127.0, "low": 118.0, "close": 120.0, "volume": 13},
            {"session_date": "2025-10-17", "open": 120.0, "high": 123.0, "low": 116.0, "close": 118.0, "volume": 14},
            {"session_date": "2026-06-26", "open": 157.5, "high": 163.9, "low": 156.5, "close": 162.0, "volume": 20},
            {"session_date": "2026-08-05", "open": 154.2, "high": 158.8, "low": 153.0, "close": 153.0, "volume": 21},
        ]

        assessment = probe.assess_raw_basis(rows)

        self.assertEqual(assessment["status"], "RAW_ANCHOR_MATCH")
        self.assertEqual(assessment["price_scale_divisor"], 1)
        self.assertEqual(assessment["anchors_matched"], 3)

    def test_raw_anchor_classifier_accepts_provider_prices_in_vnd(self):
        probe = load_probe_module()
        rows = [
            {"session_date": "2025-10-13", "open": 120000, "high": 125000, "low": 114600, "close": 122000, "volume": 10},
            {"session_date": "2025-10-14", "open": 123000, "high": 131500, "low": 120000, "close": 130000, "volume": 11},
            {"session_date": "2025-10-15", "open": 129000, "high": 130000, "low": 121000, "close": 124000, "volume": 12},
            {"session_date": "2025-10-16", "open": 124000, "high": 127000, "low": 118000, "close": 120000, "volume": 13},
            {"session_date": "2025-10-17", "open": 120000, "high": 123000, "low": 116000, "close": 118000, "volume": 14},
            {"session_date": "2026-06-26", "open": 157500, "high": 163900, "low": 156500, "close": 162000, "volume": 20},
            {"session_date": "2026-08-05", "open": 154200, "high": 158800, "low": 153000, "close": 153000, "volume": 21},
        ]

        assessment = probe.assess_raw_basis(rows)

        self.assertEqual(assessment["status"], "RAW_ANCHOR_MATCH")
        self.assertEqual(assessment["price_scale_divisor"], 1000)
        self.assertEqual(assessment["anchors_matched"], 3)

    def test_adjusted_like_prices_are_rejected_as_raw(self):
        probe = load_probe_module()
        rows = [
            {"session_date": "2025-10-13", "open": 60.0, "high": 62.0, "low": 57.3, "close": 61.0, "volume": 10},
            {"session_date": "2025-10-14", "open": 61.0, "high": 65.75, "low": 60.0, "close": 65.0, "volume": 11},
            {"session_date": "2025-10-15", "open": 64.5, "high": 65.0, "low": 60.5, "close": 62.0, "volume": 12},
            {"session_date": "2025-10-16", "open": 62.0, "high": 63.5, "low": 59.0, "close": 60.0, "volume": 13},
            {"session_date": "2025-10-17", "open": 60.0, "high": 61.5, "low": 58.0, "close": 59.0, "volume": 14},
            {"session_date": "2026-06-26", "open": 78.75, "high": 81.95, "low": 78.25, "close": 81.0, "volume": 20},
            {"session_date": "2026-08-05", "open": 77.1, "high": 79.4, "low": 76.5, "close": 76.5, "volume": 21},
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


if __name__ == "__main__":
    unittest.main()
