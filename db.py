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
  time_remaining_min INTEGER,
  cpu_percent REAL
);

CREATE INDEX IF NOT EXISTS idx_battery_samples_sampled_at
ON battery_samples(sampled_at);

CREATE TABLE IF NOT EXISTS session_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  start_percent REAL,
  end_percent REAL,
  duration_minutes REAL,
  avg_power_w REAL,
  avg_temp_c REAL,
  max_capacity INTEGER,
  design_capacity INTEGER,
  cycle_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_started_at
ON session_summaries(started_at);
"""


def init_db(path: Path):
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        try:
            conn.execute("ALTER TABLE battery_samples ADD COLUMN cpu_percent REAL")
        except Exception:
            pass


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
            SELECT sampled_at, percent, power_w, system_power_w, is_charging,
                   external_connected, temperature_c, cpu_percent
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


def current_session_start(path: Path) -> dict | None:
    """Return the sampled_at and external_connected of the first sample in the current unbroken session."""
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT MIN(sampled_at) AS session_started_at,
                   external_connected AS session_type
            FROM battery_samples
            WHERE sampled_at > (
                SELECT COALESCE(MAX(sampled_at), '1970-01-01')
                FROM battery_samples
                WHERE external_connected != (
                    SELECT external_connected
                    FROM battery_samples
                    ORDER BY sampled_at DESC
                    LIMIT 1
                )
            )
            """
        ).fetchone()
    if row and row["session_started_at"]:
        return {"session_started_at": row["session_started_at"], "session_type": bool(row["session_type"])}
    return None
