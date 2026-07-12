import re
import subprocess
from datetime import datetime, timezone

try:
    import psutil as _psutil
except ImportError:
    _psutil = None


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


def collect_sample_ctypes():
    import ctypes
    import ctypes.util
    import plistlib

    iokit_path = ctypes.util.find_library('IOKit')
    cf_path = ctypes.util.find_library('CoreFoundation')
    if not iokit_path or not cf_path:
        raise RuntimeError("Native macOS libraries not found")

    iokit = ctypes.cdll.LoadLibrary(iokit_path)
    cf = ctypes.cdll.LoadLibrary(cf_path)

    iokit.IOServiceMatching.argtypes = [ctypes.c_char_p]
    iokit.IOServiceMatching.restype = ctypes.c_void_p
    iokit.IOServiceGetMatchingService.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
    iokit.IOServiceGetMatchingService.restype = ctypes.c_uint32
    iokit.IORegistryEntryCreateCFProperties.argtypes = [
        ctypes.c_uint32,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_void_p,
        ctypes.c_uint32
    ]
    iokit.IORegistryEntryCreateCFProperties.restype = ctypes.c_int32

    cf.CFRelease.argtypes = [ctypes.c_void_p]
    cf.CFPropertyListCreateData.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_long,
        ctypes.c_ulong,
        ctypes.c_void_p
    ]
    cf.CFPropertyListCreateData.restype = ctypes.c_void_p
    cf.CFDataGetLength.argtypes = [ctypes.c_void_p]
    cf.CFDataGetLength.restype = ctypes.c_long
    cf.CFDataGetBytePtr.argtypes = [ctypes.c_void_p]
    cf.CFDataGetBytePtr.restype = ctypes.c_void_p

    matching = iokit.IOServiceMatching(b"AppleSmartBattery")
    if not matching:
        raise RuntimeError("Failed to create IOServiceMatching dictionary")

    service = iokit.IOServiceGetMatchingService(0, matching)
    if service == 0:
        raise RuntimeError("AppleSmartBattery service not found")

    properties = ctypes.c_void_p()
    kr = iokit.IORegistryEntryCreateCFProperties(service, ctypes.byref(properties), None, 0)
    iokit.IOObjectRelease(service)

    if kr != 0 or not properties.value:
        raise RuntimeError("Failed to read registry properties")

    data_ref = cf.CFPropertyListCreateData(None, properties, 200, 0, None)
    cf.CFRelease(properties)

    if not data_ref:
        raise RuntimeError("Failed to serialize properties to binary plist")

    length = cf.CFDataGetLength(data_ref)
    ptr = cf.CFDataGetBytePtr(data_ref)
    raw_bytes = ctypes.string_at(ptr, length)
    cf.CFRelease(data_ref)

    return plistlib.loads(raw_bytes)


def collect_sample():
    try:
        data = collect_sample_ctypes()
        fields = data
        adapter = data.get("AdapterDetails") or {}
        telemetry = data.get("PowerTelemetryData") or {}
    except Exception:
        # Fallback to subprocess ioreg
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
        "cpu_percent": _psutil.cpu_percent(interval=None) if _psutil else None,
    }
