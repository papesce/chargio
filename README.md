# Balanced Battery

Balanced Battery is a local macOS battery and charger monitor with a visual live power-flow view and a detailed analytics dashboard. It samples Apple Smart Battery data, stores history in SQLite, and serves a small browser UI from a single Python script.

Live mode focuses on the real-time flow of energy through the charger, laptop, and battery.

<img width="1776" height="1020" alt="Balanced Battery live view" src="https://github.com/user-attachments/assets/03225d0e-4f5a-41a9-8219-c67409d655b4" />

Details mode combines the current battery state with recent charging behavior.

<img width="1696" height="1029" alt="Balanced Battery details dashboard" src="https://github.com/user-attachments/assets/679bd9b4-251b-4835-8942-d7e0d090e028" />

Historical charts show power direction, temperature, and charge percentage over time.

<img width="1747" height="1059" alt="Screenshot 2026-05-03 at 5 21 03 PM" src="https://github.com/user-attachments/assets/6b7250d3-198d-4459-9ee3-51426cd385c3" />

## Features

- Full-screen live energy-flow visualization for charger, laptop, and battery state.
- Battery Saver UI mode for static, lower-energy graphics.
- Detailed dashboard with current metrics, charging diagnosis, and historical charts.
- Near-real-time sampling from `ioreg -r -c AppleSmartBattery`.
- SQLite history stored locally in `battery.sqlite3`.
- Optional recording filters for battery percentage and absolute power.
- No external Python dependencies.

## Requirements

- macOS with Apple Smart Battery data exposed through `ioreg`.
- Python 3.10 or newer.
- A modern browser.

This app is intended to run locally. It reads local battery telemetry and serves the UI on `127.0.0.1` by default.

## Quick Start

```bash
./bat start    # start in background → http://127.0.0.1:8765
./bat stop     # stop the server
./bat restart  # stop + start
./bat status   # check if running
```

Or run directly in the foreground:

```bash
python3 battery_app.py
```

The collector samples every 5 seconds and writes recorded samples to `battery.sqlite3`.

## Usage

Print one parsed battery sample and exit:

```bash
python3 battery_app.py --once
```

Run on a different port:

```bash
python3 battery_app.py --port 8787
```

Use a faster sampling interval:

```bash
python3 battery_app.py --interval 2
```

Store history in a custom SQLite database:

```bash
python3 battery_app.py --db /path/to/battery.sqlite3
```

Record history only inside a battery percentage range:

```bash
python3 battery_app.py --record-min-percent 20 --record-max-percent 80
```

Record only samples where battery power is at least 10 W in either direction:

```bash
python3 battery_app.py --record-min-abs-power 10
```

Recording filters only affect SQLite history. The dashboard still shows the current live sample.

## Interface

Balanced Battery has two main views:

- `Live`: the default full-screen power-flow visualization.
- `Details`: current summary metrics, charging diagnosis, and historical charts.

Use the `Live` / `Details` toggle, click the live view, scroll, or swipe to move between views.

Use `Battery Saver` to pause decorative live-flow animations and reduce heavier visual effects. The UI also uses this lower-energy mode by default when the browser reports `prefers-reduced-motion`.

## Data Model

Samples include:

- Battery percentage, voltage, current, power, capacity, cycle count, and temperature.
- Charging, external power, and full-charge flags.
- Adapter wattage, voltage, and current when macOS exposes them.
- Estimated time remaining or time to full.
- Raw parsed telemetry JSON for debugging.

Battery power is derived from battery voltage and amperage. Adapter wattage is the charger capability macOS reports, not necessarily the watts entering the battery. At high charge levels, elevated temperatures, or with Optimized Battery Charging enabled, observed battery charging watts can be much lower than the adapter rating.

## Local API

The app serves a few JSON endpoints:

- `GET /api/current`: latest live sample plus collector status.
- `GET /api/history?seconds=3600`: historical samples for the requested range, clamped between 60 seconds and 7 days.
- `GET /api/collect-now`: collect and store one immediate sample.

## Project Layout

```text
battery_app.py                       Python collector, SQLite storage, and local HTTP server
static/index.html                    Application shell
static/app.js                        UI state, data fetching, charts, and interactions
static/styles.css                    Application styling
static/power-flow/                   Power-flow visualization component and reference files
battery.sqlite3                      Local history database, created at runtime
```

## Privacy

All collection and storage is local. The app does not send battery data to a remote service. If you bind the server to a non-local host with `--host`, you are responsible for access control on your network.

## License

MIT. See [LICENSE](LICENSE).
