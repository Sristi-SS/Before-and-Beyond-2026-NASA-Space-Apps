"""Test fixtures: make ``backend`` importable when pytest runs from anywhere.

AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def pytest_configure(config):
    config.addinivalue_line("markers", "network: needs the live archives (set SPHEREX_NETWORK_TESTS=1)")
