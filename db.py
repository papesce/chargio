import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path


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
  time_remaining_min INTEGER
);

CREATE INDEX IF NOT EXISTS idx_battery_samples_sampled_at
ON battery_samples(sampled_at);
"""


def init_db(path: Path):
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)


def insert_sample(path: Path, sample: dict):
    columns = list(sample.keys())
    placeholders = ", ".join("?" for _ in columns)
    sql = f"INSERT INTO battery_samples ({', '.join(columns)}) VALUES ({placeholders})"
    values = [int(v) if isinstance(v, bool) else v for v in sample.values()]
    with sqlite3.connect(path) as conn:
        conn.execute(sql, values)


def row_to_dict(row) -> dict:
    data = dict(row)
    for key in ("is_charging", "external_connected", "fully_charged"):
        if data.get(key) is not None:
            data[key] = bool(data[key])
    return data


def latest_sample(path: Path) -> dict | None:
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM battery_samples ORDER BY sampled_at DESC LIMIT 1"
        ).fetchone()
    return row_to_dict(row) if row else None


def history_samples(path: Path, seconds: int) -> list[dict]:
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
