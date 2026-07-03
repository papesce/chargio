import json
import signal
import threading
import time
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from battery import collect_sample
from db import history_samples, init_db, insert_sample, latest_sample


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
    db_path = None
    collector = None
    static_path = None

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
            self.send_file(self.static_path / "index.html", "text/html; charset=utf-8", head_only=head_only)
            return

        if parsed.path == "/app.js":
            self.send_file(self.static_path / "app.js", "application/javascript; charset=utf-8", head_only=head_only)
            return

        if parsed.path == "/styles.css":
            self.send_file(self.static_path / "styles.css", "text/css; charset=utf-8", head_only=head_only)
            return

        if parsed.path.startswith("/power-flow/"):
            subpath = parsed.path[len("/power-flow/"):]
            file_path = self.static_path / "power-flow" / subpath
            if file_path.suffix == ".js":
                content_type = "application/javascript; charset=utf-8"
            elif file_path.suffix == ".html":
                content_type = "text/html; charset=utf-8"
            else:
                content_type = "application/octet-stream"
            self.send_file(file_path, content_type, head_only=head_only)
            return

        self.send_error(HTTPStatus.NOT_FOUND)


def run_server(host, port, interval, db_path, static_path, min_percent=None, max_percent=None, min_abs_power=None, open_browser=False):
    init_db(db_path)
    collector = Collector(db_path, interval, min_percent, max_percent, min_abs_power)
    collector.start()

    AppHandler.db_path = db_path
    AppHandler.collector = collector
    AppHandler.static_path = static_path
    server = ThreadingHTTPServer((host, port), AppHandler)

    def shutdown(_signum=None, _frame=None):
        collector.stop()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    url = f"http://{host}:{port}"
    print(f"Battery monitor running at {url}")
    print(f"SQLite history: {db_path}")
    if open_browser:
        webbrowser.open(url)
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
