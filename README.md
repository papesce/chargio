# Balanced Battery

Local macOS battery and charger monitor with near-real-time charts.

## Run

```bash
python3 battery_app.py
```

Open:

```text
http://127.0.0.1:8765
```

The app samples `ioreg -r -c AppleSmartBattery` every 5 seconds and stores history in `battery.sqlite3`.

## Useful Commands

Print one parsed sample:

```bash
python3 battery_app.py --once
```

Run on a different port or interval:

```bash
python3 battery_app.py --port 8787 --interval 2
```

## Notes

Battery watts are derived from battery voltage and amperage. Adapter wattage is the charger capability macOS reports, not the amount entering the battery. At higher percentages, elevated temperatures, or with optimized charging enabled, observed charging watts can be much lower than the adapter rating.
