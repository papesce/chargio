# Balanced Battery

<img width="1776" height="1020" alt="Screenshot 2026-05-03 at 4 51 30 PM" src="https://github.com/user-attachments/assets/03225d0e-4f5a-41a9-8219-c67409d655b4" />
<img width="1696" height="1029" alt="Screenshot 2026-05-03 at 4 51 40 PM" src="https://github.com/user-attachments/assets/679bd9b4-251b-4835-8942-d7e0d090e028" />
<img width="1772" height="1040" alt="Screenshot 2026-05-03 at 4 55 35 PM" src="https://github.com/user-attachments/assets/210376fb-36ac-47c7-b1cf-fcbe6c026597" />


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
