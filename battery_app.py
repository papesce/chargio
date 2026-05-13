#!/usr/bin/env python3
import argparse
import json
import re
import signal
import sqlite3
import subprocess
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "battery.sqlite3"
STATIC_PATH = ROOT / "static"


BATTERY_FIELDS = {
    "TimeRemaining",
    "AvgTimeToEmpty",
    "AvgTimeToFull",
    "AppleRawCurrentCapacity",
    "AppleRawMaxCapacity",
    "Voltage",
    "Amperage",
    "InstantAmperage",
    "CurrentCapacity",
    "MaxCapacity",
    "DesignCapacity",
    "CycleCount",
    "Temperature",
    "IsCharging",
    "ExternalConnected",
    "FullyCharged",
}


SCHEMA = """
CREATE TABLE IF NOT EXISTS battery_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sampled_at TEXT NOT NULL,
  percent REAL,
  voltage_mv INTEGER,
  amperage_ma INTEGER,
  instant_amperage_ma INTEGER,
  power_w REAL,
  system_power_w REAL,
  system_load_w REAL,
  is_charging INTEGER,
  external_connected INTEGER,
  fully_charged INTEGER,
  current_capacity INTEGER,
  max_capacity INTEGER,
  design_capacity INTEGER,
  cycle_count INTEGER,
  temperature_c REAL,
  adapter_watts REAL,
  adapter_voltage_mv INTEGER,
  adapter_current_ma INTEGER,
  time_remaining_min INTEGER,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_battery_samples_sampled_at
ON battery_samples(sampled_at);
"""


def run_command(args):
    return subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        timeout=8,
    ).stdout


def parse_bool(value):
    if isinstance(value, bool):
        return value
    if value in {"Yes", "YES", "true", "True", "1"}:
        return True
    if value in {"No", "NO", "false", "False", "0"}:
        return False
    return None


def int_or_none(value):
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def signed_64(value):
    if value is not None and value >= 2**63:
        return value - 2**64
    return value


def parse_top_level_fields(output):
    data = {}
    for line in output.splitlines():
        match = re.match(r'\s+"([^"]+)"\s+=\s+(.+?)\s*$', line)
        if not match:
            continue

        key, value = match.groups()
        if key not in BATTERY_FIELDS:
            continue

        if value.startswith('"') and value.endswith('"'):
            data[key] = value[1:-1]
        elif value in {"Yes", "No"}:
            data[key] = parse_bool(value)
        else:
            number = re.match(r"^-?\d+$", value)
            data[key] = int(value) if number else value

    return data


def parse_inline_object(output, object_name):
    match = re.search(rf'"{re.escape(object_name)}"\s+=\s+\{{([^}}]+)\}}', output)
    if not match:
        return {}

    body = match.group(1)
    parsed = {}
    for key, value in re.findall(r'"([^"]+)"\s*=\s*("[^"]*"|Yes|No|-?\d+)', body):
        if value.startswith('"') and value.endswith('"'):
            parsed[key] = value[1:-1]
        elif value in {"Yes", "No"}:
            parsed[key] = parse_bool(value)
        else:
            parsed[key] = int(value)
    return parsed


def collect_sample():
    output = run_command(["ioreg", "-r", "-c", "AppleSmartBattery"])
    fields = parse_top_level_fields(output)
    adapter = parse_inline_object(output, "AdapterDetails")
    telemetry = parse_inline_object(output, "PowerTelemetryData")
    battery_data = parse_inline_object(output, "BatteryData")

    voltage_mv = int_or_none(fields.get("Voltage"))
    amperage_ma = signed_64(int_or_none(fields.get("Amperage")))
    instant_amperage_ma = signed_64(int_or_none(fields.get("InstantAmperage")))
    current_capacity = int_or_none(fields.get("CurrentCapacity"))
    max_capacity = int_or_none(fields.get("MaxCapacity"))

    percent = None
    if current_capacity is not None and max_capacity:
        percent = round(current_capacity / max_capacity * 100, 2)

    power_w = None
    if voltage_mv is not None and amperage_ma is not None:
        power_w = round((voltage_mv / 1000) * (amperage_ma / 1000), 2)

    temperature_c = None
    raw_temp = int_or_none(fields.get("Temperature"))
    if raw_temp is not None:
        temperature_c = round(raw_temp / 100, 2)

    system_power_w = None
    raw_system_power = int_or_none(telemetry.get("SystemPowerIn"))
    if raw_system_power is not None:
        system_power_w = round(raw_system_power / 1000, 2)

    system_load_w = None
    raw_system_load = int_or_none(telemetry.get("SystemLoad"))
    if raw_system_load is not None:
        system_load_w = round(raw_system_load / 1000, 2)

    raw_json = {
        "fields": fields,
        "adapter": adapter,
        "telemetry": telemetry,
        "battery_data": battery_data,
    }

    return {
        "sampled_at": datetime.now(timezone.utc).isoformat(),
        "percent": percent,
        "voltage_mv": voltage_mv,
        "amperage_ma": amperage_ma,
        "instant_amperage_ma": instant_amperage_ma,
        "power_w": power_w,
        "system_power_w": system_power_w,
        "system_load_w": system_load_w,
        "is_charging": parse_bool(fields.get("IsCharging")),
        "external_connected": parse_bool(fields.get("ExternalConnected")),
        "fully_charged": parse_bool(fields.get("FullyCharged")),
        "current_capacity": current_capacity,
        "max_capacity": max_capacity,
        "design_capacity": int_or_none(fields.get("DesignCapacity")),
        "cycle_count": int_or_none(fields.get("CycleCount")),
        "temperature_c": temperature_c,
        "adapter_watts": int_or_none(adapter.get("Watts")),
        "adapter_voltage_mv": int_or_none(adapter.get("AdapterVoltage")),
        "adapter_current_ma": int_or_none(adapter.get("Current")),
        "time_remaining_min": int_or_none(fields.get("AvgTimeToFull") or fields.get("TimeRemaining")),
        "raw_json": json.dumps(raw_json, separators=(",", ":")),
    }


def init_db(path):
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)


def insert_sample(path, sample):
    columns = list(sample.keys())
    placeholders = ", ".join("?" for _ in columns)
    sql = f"INSERT INTO battery_samples ({', '.join(columns)}) VALUES ({placeholders})"
    values = [int(v) if isinstance(v, bool) else v for v in sample.values()]
    with sqlite3.connect(path) as conn:
        conn.execute(sql, values)


def row_to_dict(row):
    data = dict(row)
    for key in ("is_charging", "external_connected", "fully_charged"):
        if data.get(key) is not None:
            data[key] = bool(data[key])
    return data


def latest_sample(path):
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM battery_samples ORDER BY sampled_at DESC LIMIT 1"
        ).fetchone()
    return row_to_dict(row) if row else None


def history_samples(path, seconds):
    cutoff = datetime.fromtimestamp(time.time() - seconds, timezone.utc).isoformat()
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT sampled_at, percent, voltage_mv, amperage_ma, instant_amperage_ma,
                   power_w, system_power_w, system_load_w, is_charging,
                   external_connected, temperature_c, adapter_watts,
                   adapter_voltage_mv, adapter_current_ma, time_remaining_min
            FROM battery_samples
            WHERE sampled_at >= ?
            ORDER BY sampled_at ASC
            """,
            (cutoff,),
        ).fetchall()

    samples = [row_to_dict(row) for row in rows]
    max_points = 900
    if len(samples) <= max_points:
        return samples

    step = max(1, len(samples) // max_points)
    return samples[::step]


class Collector(threading.Thread):
    def __init__(self, db_path, interval, min_percent=None, max_percent=None, min_abs_power=None):
        super().__init__(daemon=True)
        self.db_path = db_path
        self.interval = interval
        self.min_percent = min_percent
        self.max_percent = max_percent
        self.min_abs_power = min_abs_power
        self.stop_event = threading.Event()
        self.last_error = None
        self.last_sample = None
        self.last_recorded_at = None
        self.skipped_count = 0
        self.recorded_count = 0
        self.last_skip_reason = None

    def skip_reason(self, sample):
        percent = sample.get("percent")
        power_w = sample.get("power_w")

        if self.min_percent is not None and percent is not None and percent < self.min_percent:
            return f"below {self.min_percent:g}% minimum"
        if self.max_percent is not None and percent is not None and percent > self.max_percent:
            return f"above {self.max_percent:g}% maximum"
        if self.min_abs_power is not None and power_w is not None and abs(power_w) < self.min_abs_power:
            return f"below {self.min_abs_power:g}W absolute power minimum"
        return None

    def status(self):
        return {
            "recorded_count": self.recorded_count,
            "skipped_count": self.skipped_count,
            "last_recorded_at": self.last_recorded_at,
            "last_skip_reason": self.last_skip_reason,
            "filters": {
                "min_percent": self.min_percent,
                "max_percent": self.max_percent,
                "min_abs_power": self.min_abs_power,
            },
        }

    def run(self):
        while not self.stop_event.is_set():
            started = time.time()
            try:
                sample = collect_sample()
                self.last_sample = sample
                reason = self.skip_reason(sample)
                if reason:
                    self.skipped_count += 1
                    self.last_skip_reason = reason
                else:
                    insert_sample(self.db_path, sample)
                    self.recorded_count += 1
                    self.last_recorded_at = sample["sampled_at"]
                    self.last_skip_reason = None
                self.last_error = None
            except Exception as exc:
                self.last_error = str(exc)

            elapsed = time.time() - started
            self.stop_event.wait(max(0.5, self.interval - elapsed))

    def stop(self):
        self.stop_event.set()


class AppHandler(BaseHTTPRequestHandler):
    db_path = DB_PATH
    collector = None

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def send_json(self, payload, status=HTTPStatus.OK, head_only=False):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def send_file(self, path, content_type, head_only=False):
        try:
            body = path.read_bytes()
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def do_GET(self):
        self.route(head_only=False)

    def do_HEAD(self):
        self.route(head_only=True)

    def route(self, head_only=False):
        parsed = urlparse(self.path)

        if parsed.path == "/api/current":
            live_sample = self.collector.last_sample if self.collector else None
            self.send_json({
                "sample": live_sample or latest_sample(self.db_path),
                "collector_error": self.collector.last_error if self.collector else None,
                "collector_status": self.collector.status() if self.collector else None,
            }, head_only=head_only)
            return

        if parsed.path == "/api/history":
            params = parse_qs(parsed.query)
            seconds = int(params.get("seconds", ["3600"])[0])
            seconds = max(60, min(seconds, 7 * 24 * 3600))
            self.send_json({"samples": history_samples(self.db_path, seconds)}, head_only=head_only)
            return

        if parsed.path == "/api/collect-now":
            try:
                sample = collect_sample()
                insert_sample(self.db_path, sample)
                self.send_json({"sample": latest_sample(self.db_path)}, head_only=head_only)
            except Exception as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR, head_only=head_only)
            return

        if parsed.path in {"/", "/index.html"}:
            self.send_file(STATIC_PATH / "index.html", "text/html; charset=utf-8", head_only=head_only)
            return

        if parsed.path == "/app.js":
            self.send_file(STATIC_PATH / "app.js", "application/javascript; charset=utf-8", head_only=head_only)
            return

        if parsed.path == "/styles.css":
            self.send_file(STATIC_PATH / "styles.css", "text/css; charset=utf-8", head_only=head_only)
            return

        if parsed.path.startswith("/power-flow/"):
            subpath = parsed.path[len("/power-flow/"):]
            file_path = STATIC_PATH / "power-flow" / subpath
            if file_path.suffix == ".js":
                content_type = "application/javascript; charset=utf-8"
            elif file_path.suffix == ".html":
                content_type = "text/html; charset=utf-8"
            else:
                content_type = "application/octet-stream"
            self.send_file(file_path, content_type, head_only=head_only)
            return

        self.send_error(HTTPStatus.NOT_FOUND)


def run_server(host, port, interval, db_path, min_percent=None, max_percent=None, min_abs_power=None):
    init_db(db_path)
    collector = Collector(db_path, interval, min_percent, max_percent, min_abs_power)
    collector.start()

    AppHandler.db_path = db_path
    AppHandler.collector = collector
    server = ThreadingHTTPServer((host, port), AppHandler)

    def shutdown(_signum=None, _frame=None):
        collector.stop()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print(f"Battery monitor running at http://{host}:{port}")
    print(f"SQLite history: {db_path}")
    if any(value is not None for value in (min_percent, max_percent, min_abs_power)):
        print("Recording filters:")
        if min_percent is not None:
            print(f"  minimum battery percent: {min_percent:g}%")
        if max_percent is not None:
            print(f"  maximum battery percent: {max_percent:g}%")
        if min_abs_power is not None:
            print(f"  minimum absolute battery power: {min_abs_power:g}W")
    try:
        server.serve_forever()
    finally:
        collector.stop()
        collector.join(timeout=3)
        server.server_close()


def print_once():
    sample = collect_sample()
    print(json.dumps(sample, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Local macOS battery monitor")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--db", type=Path, default=DB_PATH)
    parser.add_argument("--record-min-percent", type=float, help="only store samples at or above this battery percent")
    parser.add_argument("--record-max-percent", type=float, help="only store samples at or below this battery percent")
    parser.add_argument("--record-min-abs-power", type=float, help="only store samples at or above this absolute battery power in watts")
    parser.add_argument("--once", action="store_true", help="print one sample and exit")
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
        args.record_min_percent,
        args.record_max_percent,
        args.record_min_abs_power,
    )


if __name__ == "__main__":
    main()
