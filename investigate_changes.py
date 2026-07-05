#!/usr/bin/env python3
import time
from datetime import datetime, timezone
from battery import collect_sample

IGNORE_FIELDS = {"sampled_at"}
DURATION_SECS = 300

def main():
    prev = None
    change_counts = {}
    total_samples = 0
    changes_detected = 0
    secs_since_change = 0

    print("sampled_at, changed_fields")
    start = time.time()

    while time.time() - start < DURATION_SECS:
        sample = collect_sample()
        total_samples += 1
        now = sample["sampled_at"]

        elapsed = time.time() - start
        print(f"[{elapsed:5.1f}s] (no-chg: {secs_since_change}s) ", end="")

        changed = []
        if prev is not None:
            for key in sample:
                if key in IGNORE_FIELDS:
                    continue
                a, b = prev.get(key), sample.get(key)
                if a != b:
                    changed.append(key)
                    change_counts[key] = change_counts.get(key, 0) + 1
            if changed:
                changes_detected += 1
                secs_since_change = 0
                print(f"{now}, {', '.join(sorted(changed))}")
            else:
                secs_since_change += 1
                print(f"{now}, (no change)")
        else:
            print(f"{now}, (first sample - baseline)")

        prev = sample
        remaining = max(0, 1.0 - (time.time() - (start + int(elapsed))))
        while remaining > 0:
            print(f"\r  waiting... {remaining:4.1f}s ", end="", flush=True)
            tick = min(remaining, 1.0)
            time.sleep(tick)
            remaining = max(0, 1.0 - (time.time() - (start + int(elapsed))))
        print("\r" + " " * 20, end="\r")  # clear the waiting line

    duration = time.time() - start
    print()
    print(f"Ran for {duration:.1f}s, {total_samples} samples, {changes_detected} samples with changes")
    print()
    print("Per-field change counts:")
    for key in sorted(change_counts, key=lambda k: -change_counts[k]):
        pct = change_counts[key] / max(total_samples - 1, 1) * 100
        print(f"  {key}: {change_counts[key]} changes ({pct:.1f}%)")
    print()
    for key in sorted(change_counts, key=lambda k: -change_counts[k]):
        if change_counts[key] == 0:
            continue
        if change_counts[key] == total_samples - 1:
            print(f"⚠  {key} changed on EVERY sample (may be noisy/flickering)")
        elif change_counts[key] > (total_samples - 1) * 0.8:
            print(f"~  {key} changed on >80% of samples")

if __name__ == "__main__":
    main()
