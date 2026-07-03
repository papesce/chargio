import re
import subprocess
from datetime import datetime, timezone


BATTERY_FIELDS = {
    "TimeRemaining",
    "AvgTimeToEmpty",
    "AvgTimeToFull",
    "AppleRawCurrentCapacity",
    "AppleRawMaxCapacity",
    "Voltage",
    "Amperage",
    "InstantAmperage",
    "CurrentCapacity",
    "MaxCapacity",
    "DesignCapacity",
    "CycleCount",
    "Temperature",
    "IsCharging",
    "ExternalConnected",
    "FullyCharged",
}


def run_command(args):
    return subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        timeout=8,
    ).stdout


def parse_bool(value):
    if isinstance(value, bool):
        return value
    if value in {"Yes", "YES", "true", "True", "1"}:
        return True
    if value in {"No", "NO", "false", "False", "0"}:
        return False
    return None


def int_or_none(value):
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def signed_64(value):
    if value is not None and value >= 2**63:
        return value - 2**64
    return value


def parse_top_level_fields(output):
    data = {}
    for line in output.splitlines():
        match = re.match(r'\s+"([^"]+)"\s+=\s+(.+?)\s*$', line)
        if not match:
            continue

        key, value = match.groups()
        if key not in BATTERY_FIELDS:
            continue

        if value.startswith('"') and value.endswith('"'):
            data[key] = value[1:-1]
        elif value in {"Yes", "No"}:
            data[key] = parse_bool(value)
        else:
            number = re.match(r"^-?\d+$", value)
            data[key] = int(value) if number else value

    return data


def parse_inline_object(output, object_name):
    match = re.search(rf'"{re.escape(object_name)}"\s+=\s+\{{([^}}]+)\}}', output)
    if not match:
        return {}

    body = match.group(1)
    parsed = {}
    for key, value in re.findall(r'"([^"]+)"\s*=\s*("[^"]*"|Yes|No|-?\d+)', body):
        if value.startswith('"') and value.endswith('"'):
            parsed[key] = value[1:-1]
        elif value in {"Yes", "No"}:
            parsed[key] = parse_bool(value)
        else:
            parsed[key] = int(value)
    return parsed


def collect_sample():
    output = run_command(["ioreg", "-r", "-c", "AppleSmartBattery"])
    fields = parse_top_level_fields(output)
    adapter = parse_inline_object(output, "AdapterDetails")
    telemetry = parse_inline_object(output, "PowerTelemetryData")

    voltage_mv = int_or_none(fields.get("Voltage"))
    amperage_ma = signed_64(int_or_none(fields.get("Amperage")))
    instant_amperage_ma = signed_64(int_or_none(fields.get("InstantAmperage")))
    current_capacity = int_or_none(fields.get("CurrentCapacity"))
    max_capacity = int_or_none(fields.get("MaxCapacity"))

    percent = None
    if current_capacity is not None and max_capacity:
        percent = round(current_capacity / max_capacity * 100, 2)

    power_w = None
    if voltage_mv is not None and amperage_ma is not None:
        power_w = round((voltage_mv / 1000) * (amperage_ma / 1000), 2)

    temperature_c = None
    raw_temp = int_or_none(fields.get("Temperature"))
    if raw_temp is not None:
        temperature_c = round(raw_temp / 100, 2)

    system_power_w = None
    raw_system_power = int_or_none(telemetry.get("SystemPowerIn"))
    if raw_system_power is not None:
        system_power_w = round(raw_system_power / 1000, 2)

    system_load_w = None
    raw_system_load = int_or_none(telemetry.get("SystemLoad"))
    if raw_system_load is not None:
        system_load_w = round(raw_system_load / 1000, 2)

    return {
        "sampled_at": datetime.now(timezone.utc).isoformat(),
        "percent": percent,
        "voltage_mv": voltage_mv,
        "amperage_ma": amperage_ma,
        "instant_amperage_ma": instant_amperage_ma,
        "power_w": power_w,
        "system_power_w": system_power_w,
        "system_load_w": system_load_w,
        "is_charging": parse_bool(fields.get("IsCharging")),
        "external_connected": parse_bool(fields.get("ExternalConnected")),
        "fully_charged": parse_bool(fields.get("FullyCharged")),
        "current_capacity": current_capacity,
        "max_capacity": max_capacity,
        "design_capacity": int_or_none(fields.get("DesignCapacity")),
        "cycle_count": int_or_none(fields.get("CycleCount")),
        "temperature_c": temperature_c,
        "adapter_watts": int_or_none(adapter.get("Watts")),
        "adapter_voltage_mv": int_or_none(adapter.get("AdapterVoltage")),
        "adapter_current_ma": int_or_none(adapter.get("Current")),
        "time_remaining_min": int_or_none(fields.get("AvgTimeToFull") or fields.get("TimeRemaining")),
    }
