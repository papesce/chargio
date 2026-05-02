# Battery Monitoring App Plan

## Goal

Build a local near-real-time dashboard for macOS battery and charger behavior. The main question the app should answer is whether the current charger, cable, and port are delivering the best charging rate the machine can accept under current conditions.

## Core Signals

Collect these values every 2-5 seconds:

- Battery percentage
- Current capacity
- Maximum capacity
- Design capacity
- Voltage, usually reported in millivolts
- Amperage, usually reported in milliamps
- Derived charging or discharging watts
- Charging state
- External power connected state
- Adapter details, including detected charger wattage when available
- Battery temperature
- Cycle count
- Time remaining estimate

Primary macOS sources:

```bash
pmset -g batt
ioreg -r -c AppleSmartBattery
system_profiler SPPowerDataType
```

The most useful source for frequent polling is usually:

```bash
ioreg -r -c AppleSmartBattery
```

## Derived Metrics

Compute power from voltage and amperage:

```text
watts = (Voltage / 1000) * (Amperage / 1000)
```

Normalize the sign so the UI can clearly show:

- Charging watts
- Discharging watts
- Net battery power

The app should distinguish charger capability from actual battery charge rate. A 96W adapter does not mean 96W is entering the battery. The machine may consume part of the input power, and macOS may reduce charging due to battery percentage, temperature, battery health, or optimized charging.

## Storage

Use SQLite for local history. Store one sample per polling interval.

Suggested table:

```sql
CREATE TABLE battery_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sampled_at TEXT NOT NULL,
  percent REAL,
  voltage_mv INTEGER,
  amperage_ma INTEGER,
  power_w REAL,
  is_charging INTEGER,
  external_connected INTEGER,
  cycle_count INTEGER,
  temperature_c REAL,
  adapter_watts REAL,
  time_remaining_min INTEGER,
  raw_json TEXT
);
```

Keep raw parsed source data in `raw_json` so the parser can improve later without losing diagnostic detail.

## Dashboard

Build a local web dashboard with:

- Current battery percentage
- Current charging or discharging watts
- Voltage
- Amperage
- Temperature
- Charger detected wattage
- Charging state
- Time to full or time remaining
- Chart of watts over time
- Chart of battery percentage over time
- Chart of temperature over time
- Optional event markers for charger connect, disconnect, sleep, wake, and charge state changes

The most important view is charging watts over time compared with battery percentage. This shows whether the charger ramps up at low battery and tapers normally as the battery fills.

## Suggested Stack

Pragmatic local stack:

- Python collector
- SQLite database
- FastAPI backend
- React frontend
- ECharts or Recharts for time-series charts

Alternative simpler first version:

- Python collector
- SQLite database
- Single FastAPI app serving HTML
- Chart.js via browser asset

## Collector Design

Responsibilities:

1. Poll `ioreg -r -c AppleSmartBattery` every 2-5 seconds.
2. Parse battery fields into structured data.
3. Optionally poll slower sources like `system_profiler SPPowerDataType` every 30-60 seconds for adapter details.
4. Compute derived watts and normalized charge direction.
5. Insert samples into SQLite.
6. Avoid blocking the dashboard if a command temporarily fails.

## API Design

Suggested endpoints:

```text
GET /api/current
GET /api/history?range=1h
GET /api/history?range=24h
GET /api/events
```

`/api/current` should return the newest sample.

`/api/history` should downsample older ranges so charts remain responsive.

## Charging Diagnosis Logic

The app should help explain why observed charging wattage may be lower than expected:

- Battery is above roughly 70-80%, so charging naturally tapers.
- Battery temperature is high.
- Optimized battery charging is active.
- Cable is limiting power.
- USB-C hub, dock, or port is limiting power.
- Machine workload is consuming a large share of adapter power.
- Battery health or cycle count is affecting behavior.
- Adapter is detected below its rated wattage.

## First Milestone

Create a working command-line collector:

1. Poll battery data every 5 seconds.
2. Print percent, voltage, amperage, watts, charger state, and temperature.
3. Store samples in SQLite.
4. Run for 30 minutes while charging and verify the charging curve looks plausible.

## Second Milestone

Add the local dashboard:

1. Serve current sample and historical samples through an API.
2. Show live cards for key metrics.
3. Add charts for watts, percent, and temperature.
4. Refresh the current view every 2-5 seconds.

## Third Milestone

Add charger quality analysis:

1. Detect charger connect and disconnect events.
2. Compare detected adapter wattage with observed charging watts.
3. Flag suspicious cases, such as low charging watts at low battery and normal temperature.
4. Add session summaries for each charging session.

