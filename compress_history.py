#!/usr/bin/env python3
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "battery.sqlite3"


def parse_iso(dt_str):
    if "+" in dt_str:
        dt_str = dt_str.split("+")[0]
    return datetime.fromisoformat(dt_str)


def compress_history(db_path: Path):
    from db import init_db
    init_db(db_path)

    # We will compress samples older than 24 hours (86400 seconds)
    cutoff = datetime.fromtimestamp(time.time() - 86400, timezone.utc).isoformat()

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        samples = conn.execute(
            "SELECT * FROM battery_samples WHERE sampled_at < ? ORDER BY sampled_at ASC",
            (cutoff,)
        ).fetchall()

    if not samples:
        print("No old samples to compress.")
        return

    sessions = []
    current_session = []

    for row in samples:
        sample = dict(row)
        if not current_session:
            current_session.append(sample)
            continue

        last_sample = current_session[-1]

        # Check for state changes or a large time gap (> 30 mins)
        state_changed = (sample["external_connected"] != last_sample["external_connected"])

        try:
            t1 = parse_iso(last_sample["sampled_at"])
            t2 = parse_iso(sample["sampled_at"])
            gap_minutes = (t2 - t1).total_seconds() / 60
        except Exception:
            gap_minutes = 0

        if state_changed or gap_minutes > 30:
            sessions.append(current_session)
            current_session = [sample]
        else:
            current_session.append(sample)

    if current_session:
        sessions.append(current_session)

    summarized_ids = []
    created_sessions_count = 0

    with sqlite3.connect(db_path) as conn:
        for session in sessions:
            if len(session) < 2:
                summarized_ids.extend([s["id"] for s in session])
                continue

            first = session[0]
            last = session[-1]

            try:
                t_start = parse_iso(first["sampled_at"])
                t_end = parse_iso(last["sampled_at"])
                duration = (t_end - t_start).total_seconds() / 60
            except Exception:
                duration = 0

            # Ignore sessions shorter than 3 minutes as noise
            if duration < 3:
                summarized_ids.extend([s["id"] for s in session])
                continue

            session_type = "charge" if last["external_connected"] else "discharge"

            # Calculate averages
            powers = [s["power_w"] for s in session if s["power_w"] is not None]
            temps = [s["temperature_c"] for s in session if s["temperature_c"] is not None]

            avg_power = round(sum(powers) / len(powers), 2) if powers else None
            avg_temp = round(sum(temps) / len(temps), 2) if temps else None

            conn.execute(
                """
                INSERT INTO session_summaries (
                    session_type, started_at, ended_at, start_percent, end_percent,
                    duration_minutes, avg_power_w, avg_temp_c, max_capacity,
                    design_capacity, cycle_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_type,
                    first["sampled_at"],
                    last["sampled_at"],
                    first["percent"],
                    last["percent"],
                    round(duration, 1),
                    avg_power,
                    avg_temp,
                    last["max_capacity"],
                    last["design_capacity"],
                    last["cycle_count"]
                )
            )
            created_sessions_count += 1
            summarized_ids.extend([s["id"] for s in session])

        # Delete raw samples that were processed
        if summarized_ids:
            chunk_size = 999
            for i in range(0, len(summarized_ids), chunk_size):
                chunk = summarized_ids[i:i+chunk_size]
                placeholders = ",".join("?" for _ in chunk)
                conn.execute(f"DELETE FROM battery_samples WHERE id IN ({placeholders})", chunk)

            print(f"Compressed {len(summarized_ids)} raw samples into {created_sessions_count} session summaries.")
            conn.commit()


if __name__ == "__main__":
    compress_history(DB_PATH)
