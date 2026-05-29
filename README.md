# Chargio

Chargio is a local macOS battery and charger monitor with a visual live power-flow view and a detailed analytics dashboard. It samples Apple Smart Battery data, stores history in SQLite, and serves a small browser UI from a single Python script.

Live mode focuses on the real-time flow of energy through the charger, laptop, and battery.
<img width="1776" height="1020" alt="Chargio live view" src="https://github.com/user-attachments/assets/03225d0e-4f5a-41a9-8219-c67409d655b4" />

Details mode combines the current battery state with recent charging behavior.

<img width="1638" height="996" alt="Screenshot 2026-05-20 at 5 03 20 PM" src="https://github.com/user-attachments/assets/ddc4c57c-9502-4e1c-9462-95ac553ba2da" />



Historical charts show power direction, temperature, and charge percentage over time.

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
./chargio start    # start in background -> http://127.0.0.1:7943
./chargio stop     # stop the server
./chargio restart  # stop + start
./chargio status   # check if running
./chargio open     # start if needed and open in your browser
```

Or run directly in the foreground:

```bash
python3 chargio.py
```

The collector samples every 5 seconds and writes recorded samples to `battery.sqlite3`.

## Global CLI

Install the launcher into `~/.local/bin` so `chargio` works from any terminal:

```bash
./chargio install-cli
```

If `~/.local/bin` is not already in your shell `PATH`, add it:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Then run Chargio from anywhere:

```bash
chargio start
chargio open
chargio stop
chargio status
```

Remove the global command:

```bash
chargio uninstall-cli
```

## Usage

Print one parsed battery sample and exit:

```bash
python3 chargio.py --once
```

Run on a different port:

```bash
python3 chargio.py --port 8787
```

Or with the shell launcher:

```bash
CHARGIO_PORT=8787 chargio start
```

Use a faster sampling interval:

```bash
python3 chargio.py --interval 2
```

Store history in a custom SQLite database:

```bash
python3 chargio.py --db /path/to/battery.sqlite3
```

Record history only inside a battery percentage range:

```bash
python3 chargio.py --record-min-percent 20 --record-max-percent 80
```

Record only samples where battery power is at least 10 W in either direction:

```bash
python3 chargio.py --record-min-abs-power 10
```

Recording filters only affect SQLite history. The dashboard still shows the current live sample.

## Interface

Chargio has two main views:

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
chargio.py                           Python collector, SQLite storage, and local HTTP server
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
