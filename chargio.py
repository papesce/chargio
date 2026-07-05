#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from battery import collect_sample
from server import run_server


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "battery.sqlite3"
STATIC_PATH = ROOT / "static"


def print_once():
    sample = collect_sample()
    print(json.dumps(sample, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Local macOS battery monitor")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7943)
    parser.add_argument("--interval", type=float, default=60.0)
    parser.add_argument("--db", type=Path, default=DB_PATH)
    parser.add_argument("--record-min-percent", type=float, help="only store samples at or above this battery percent")
    parser.add_argument("--record-max-percent", type=float, help="only store samples at or below this battery percent")
    parser.add_argument("--record-min-abs-power", type=float, help="only store samples at or above this absolute battery power in watts")
    parser.add_argument("--once", action="store_true", help="print one sample and exit")
    parser.add_argument("--open", action="store_true", help="open the browser automatically after starting")
    args = parser.parse_args()

    if args.once:
        print_once()
        return

    if (
        args.record_min_percent is not None
        and args.record_max_percent is not None
        and args.record_min_percent > args.record_max_percent
    ):
        parser.error("--record-min-percent cannot be greater than --record-max-percent")

    run_server(
        args.host,
        args.port,
        args.interval,
        args.db,
        STATIC_PATH,
        args.record_min_percent,
        args.record_max_percent,
        args.record_min_abs_power,
        args.open,
    )


if __name__ == "__main__":
    main()
