# Balanced Battery

Local macOS battery and charger monitor with near-real-time charts.
<img width="1383" height="1081" alt="last" src="https://github.com/user-attachments/assets/de94ccce-6075-4a38-b7cc-24897f871301" />



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

Record history only inside a battery percentage range:

```bash
python3 battery_app.py --record-min-percent 20 --record-max-percent 80
```

Record only samples where battery power is at least 10W in either direction:

```bash
python3 battery_app.py --record-min-abs-power 10
```

Filters only affect SQLite history. The dashboard still shows the current live battery sample.

## Notes

Battery watts are derived from battery voltage and amperage. Adapter wattage is the charger capability macOS reports, not the amount entering the battery. At higher percentages, elevated temperatures, or with optimized charging enabled, observed charging watts can be much lower than the adapter rating.
