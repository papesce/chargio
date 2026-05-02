const state = {
  seconds: 3600,
  samples: [],
};

const $ = (id) => document.getElementById(id);

function fmt(value, suffix = "", digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function fmtInt(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Math.round(Number(value))}${suffix}`;
}

function localTime(iso) {
  if (!iso) return "--";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function minutesLabel(minutes) {
  if (!minutes || minutes === 65535) return "--";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

function estimateDischargeMinutes(sample, samples) {
  if (!sample || sample.external_connected || sample.percent === null || sample.percent === undefined) {
    return null;
  }
  if (!Array.isArray(samples) || samples.length < 2) return null;

  const unplugged = samples.filter((item) => (
    item
    && !item.external_connected
    && item.percent !== null
    && item.percent !== undefined
  ));
  if (unplugged.length < 2) return null;

  const first = unplugged[0];
  const last = unplugged[unplugged.length - 1];
  const startMs = new Date(first.sampled_at).getTime();
  const endMs = new Date(last.sampled_at).getTime();
  const elapsedMinutes = (endMs - startMs) / 60000;
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes <= 0) return null;

  const percentDrop = Number(first.percent) - Number(last.percent);
  if (!Number.isFinite(percentDrop) || percentDrop <= 0) return null;

  const dropPerMinute = percentDrop / elapsedMinutes;
  if (!Number.isFinite(dropPerMinute) || dropPerMinute <= 0) return null;

  return Math.round(Number(sample.percent) / dropPerMinute);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function activeFilters(filters) {
  if (!filters) return [];
  const labels = [];
  if (filters.min_percent !== null && filters.min_percent !== undefined) {
    labels.push(`>= ${filters.min_percent}%`);
  }
  if (filters.max_percent !== null && filters.max_percent !== undefined) {
    labels.push(`<= ${filters.max_percent}%`);
  }
  if (filters.min_abs_power !== null && filters.min_abs_power !== undefined) {
    labels.push(`>= ${filters.min_abs_power}W abs`);
  }
  return labels;
}

function updateCurrent(sample, collectorError, collectorStatus, samples = []) {
  if (!sample) {
    $("subtitle").textContent = collectorError || "No samples yet";
    return;
  }

  $("percent").textContent = fmt(sample.percent, "%", 1);
  $("state").textContent = sample.external_connected
    ? (sample.is_charging ? "Charging on external power" : "External power connected")
    : "On battery";
  $("power").textContent = fmt(sample.power_w, " W", 1);
  $("amperage").textContent = `${fmtInt(sample.amperage_ma, " mA")} battery current`;
  $("adapter").textContent = sample.adapter_watts ? `${sample.adapter_watts} W` : "--";
  $("adapter-detail").textContent = sample.adapter_voltage_mv
    ? `${fmt(sample.adapter_voltage_mv / 1000, " V", 1)} at ${fmt(sample.adapter_current_ma / 1000, " A", 1)}`
    : "--";
  $("voltage").textContent = fmt(sample.voltage_mv / 1000, " V", 2);
  $("capacity").textContent = `${fmtInt(sample.current_capacity)} / ${fmtInt(sample.max_capacity)} mAh`;
  $("temperature").textContent = fmt(sample.temperature_c, " C", 1);
  $("cycles").textContent = `${fmtInt(sample.cycle_count)} cycles`;
  const unpluggedEstimate = estimateDischargeMinutes(sample, samples);
  if (!sample.external_connected) {
    const estimate = unpluggedEstimate ?? sample.time_remaining_min;
    const label = minutesLabel(estimate);
    $("remaining").textContent = label === "--" ? "--" : `${label} est`;
  } else {
    $("remaining").textContent = minutesLabel(sample.time_remaining_min);
  }
  $("sampled").textContent = `sampled ${localTime(sample.sampled_at)}`;
  const filters = activeFilters(collectorStatus?.filters);
  const recordingText = collectorStatus?.last_skip_reason
    ? `live ${localTime(sample.sampled_at)}; not recording, ${collectorStatus.last_skip_reason}`
    : `live ${localTime(sample.sampled_at)}; recording`;
  const filterText = filters.length ? ` (${filters.join(", ")})` : "";
  $("subtitle").textContent = collectorError || `${recordingText}${filterText}`;
  updateDiagnosis(sample);
}

function updateDiagnosis(sample) {
  const messages = [];
  const cls = [];
  if (!sample.external_connected) {
    messages.push("External power is not connected.");
    cls.push("warn");
  } else if (sample.adapter_watts && sample.power_w !== null) {
    const ratio = sample.power_w / sample.adapter_watts;
    if (sample.percent < 75 && sample.temperature_c < 38 && ratio < 0.25) {
      messages.push("Charging power is low for the detected adapter while battery percentage and temperature leave room for faster charging. Check cable, port, hub, or optimized charging state.");
      cls.push("warn");
    } else if (sample.percent >= 80) {
      messages.push("Battery is in the normal taper range, so charging watts can be much lower than adapter wattage.");
      cls.push("good");
    } else if (sample.temperature_c >= 38) {
      messages.push("Battery temperature is elevated, so macOS may reduce charge rate.");
      cls.push("warn");
    } else {
      messages.push("Charging behavior looks plausible for the current battery state. Compare the power chart against percentage over a longer session.");
      cls.push("good");
    }
  } else {
    messages.push("Adapter details are unavailable. Direct USB-C charging usually exposes more useful data than some hubs or docks.");
  }

  if (sample.system_power_w) {
    messages.push(`System input is about ${fmt(sample.system_power_w, " W", 1)}; battery power is about ${fmt(sample.power_w, " W", 1)}.`);
  }

  $("diagnosis").innerHTML = messages
    .map((message, index) => `<p class="${cls[index] || ""}">${message}</p>`)
    .join("");
}

function series(samples, key) {
  return samples
    .map((sample) => ({ x: new Date(sample.sampled_at), y: sample[key] }))
    .filter((point) => point.y !== null && point.y !== undefined && !Number.isNaN(Number(point.y)));
}

function drawChart(canvasId, points, options = {}) {
  const canvas = $(canvasId);
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(180, Math.floor(rect.height * dpr));
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const pad = { top: 16, right: 18, bottom: 28, left: 48 };
  ctx.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.documentElement);
  const line = styles.getPropertyValue("--line").trim();
  const text = styles.getPropertyValue("--muted").trim();
  const accent = options.color || styles.getPropertyValue("--accent").trim();

  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = text;

  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  if (points.length < 2) {
    ctx.fillText("Collecting samples", pad.left, pad.top + 24);
    return;
  }

  const xs = points.map((p) => p.x.getTime());
  const ys = points.map((p) => Number(p.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  let minY = options.min ?? Math.min(...ys);
  let maxY = options.max ?? Math.max(...ys);
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const yPad = (maxY - minY) * 0.12;
  minY = options.min ?? minY - yPad;
  maxY = options.max ?? maxY + yPad;

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    const label = maxY - ((maxY - minY) / 4) * i;
    ctx.fillText(label.toFixed(options.digits ?? 1), 6, y + 4);
  }

  ctx.beginPath();
  points.forEach((point, index) => {
    const x = pad.left + ((point.x.getTime() - minX) / Math.max(1, maxX - minX)) * plotW;
    const y = pad.top + (1 - ((Number(point.y) - minY) / (maxY - minY))) * plotH;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  const first = new Date(minX).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const last = new Date(maxX).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  ctx.fillStyle = text;
  ctx.fillText(first, pad.left, height - 8);
  ctx.textAlign = "right";
  ctx.fillText(last, width - pad.right, height - 8);
  ctx.textAlign = "left";
}

function themeRgb(varName) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (raw.startsWith("#")) {
    const h = raw.slice(1);
    if (h.length !== 6) return { r: 15, g: 123, b: 99 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  const match = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
  }
  return { r: 15, g: 123, b: 99 };
}

function rgba(rgb, alpha) {
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

const powerSwitchMarkerCache = { stroke: "", schemeKey: "" };

function invalidatePowerSwitchMarkerCache() {
  powerSwitchMarkerCache.stroke = "";
  powerSwitchMarkerCache.schemeKey = "";
}

function powerSwitchMarkerStrokeStyle() {
  const schemeKey = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  if (powerSwitchMarkerCache.stroke && powerSwitchMarkerCache.schemeKey === schemeKey) {
    return powerSwitchMarkerCache.stroke;
  }
  const probe = document.createElement("span");
  probe.className = "legend-item legend-item-switch";
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;";
  document.body.appendChild(probe);
  const { borderTopColor } = getComputedStyle(probe, "::before");
  document.body.removeChild(probe);
  const fallback = rgba(themeRgb("--muted"), 0.7);
  const color = borderTopColor && borderTopColor !== "rgba(0, 0, 0, 0)" && borderTopColor !== "transparent"
    ? borderTopColor
    : fallback;
  powerSwitchMarkerCache.stroke = color;
  powerSwitchMarkerCache.schemeKey = schemeKey;
  return color;
}

function expandPowerPointsWithZeroCrossings(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    out.push(points[i]);
    if (i < points.length - 1) {
      const a = points[i];
      const b = points[i + 1];
      const y0 = Number(a.y);
      const y1 = Number(b.y);
      if (y0 !== 0 && y1 !== 0 && y0 * y1 < 0) {
        const t0 = a.x.getTime();
        const t1 = b.x.getTime();
        const crossT = t0 + (t1 - t0) * (y0 / (y0 - y1));
        out.push({ x: new Date(crossT), y: 0 });
      }
    }
  }
  return out;
}

function drawPowerChart(canvasId, points) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(180, Math.floor(rect.height * dpr));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const pad = { top: 16, right: 18, bottom: 28, left: 48 };
  ctx.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.documentElement);
  const line = styles.getPropertyValue("--line").trim();
  const text = styles.getPropertyValue("--muted").trim();
  const chargeRgb = themeRgb("--good");
  const dischargeRgb = themeRgb("--warn");

  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = text;

  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  if (points.length < 2) {
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.fillText("Collecting samples", pad.left, pad.top + 24);
    return;
  }

  const expanded = expandPowerPointsWithZeroCrossings(points);
  const xs = expanded.map((p) => p.x.getTime());
  const rawYs = points.map((p) => Number(p.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);

  let minY = Math.min(0, ...rawYs);
  let maxY = Math.max(0, ...rawYs);
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const yPad = (maxY - minY) * 0.12;
  minY -= yPad;
  maxY += yPad;
  minY = Math.min(minY, 0);
  maxY = Math.max(maxY, 0);

  const xToPx = (t) => pad.left + ((t - minX) / Math.max(1, maxX - minX)) * plotW;
  const yToPy = (y) => pad.top + (1 - ((Number(y) - minY) / (maxY - minY))) * plotH;

  const zeroY = yToPy(0);

  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    const label = maxY - ((maxY - minY) / 4) * i;
    ctx.fillStyle = text;
    ctx.fillText(`${label.toFixed(1)} W`, 6, y + 4);
  }

  ctx.save();
  ctx.strokeStyle = powerSwitchMarkerStrokeStyle();
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 6]);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const y0 = Number(a.y);
    const y1 = Number(b.y);
    if (y0 !== 0 && y1 !== 0 && y0 * y1 < 0) {
      const t0 = a.x.getTime();
      const t1 = b.x.getTime();
      const crossT = t0 + (t1 - t0) * (y0 / (y0 - y1));
      const x = xToPx(crossT);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.fillStyle = rgba(chargeRgb, 0.08);
  ctx.fillRect(pad.left, pad.top, plotW, Math.max(0, zeroY - pad.top));
  ctx.fillStyle = rgba(dischargeRgb, 0.1);
  ctx.fillRect(pad.left, zeroY, plotW, Math.max(0, pad.top + plotH - zeroY));

  for (let i = 0; i < expanded.length - 1; i += 1) {
    const p0 = expanded[i];
    const p1 = expanded[i + 1];
    const x0 = xToPx(p0.x.getTime());
    const x1 = xToPx(p1.x.getTime());
    const y0 = yToPy(p0.y);
    const y1 = yToPy(p1.y);
    const mid = (Number(p0.y) + Number(p1.y)) / 2;
    ctx.fillStyle = mid >= 0 ? rgba(chargeRgb, 0.2) : rgba(dischargeRgb, 0.22);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, zeroY);
    ctx.lineTo(x0, zeroY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = text;
  ctx.lineWidth = 1.75;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(pad.left, zeroY);
  ctx.lineTo(width - pad.right, zeroY);
  ctx.stroke();
  ctx.fillStyle = text;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("0 W", width - pad.right - 4, zeroY - 5);
  ctx.textAlign = "left";
  ctx.font = "12px system-ui, sans-serif";

  ctx.lineWidth = 2;
  for (let i = 0; i < expanded.length - 1; i += 1) {
    const p0 = expanded[i];
    const p1 = expanded[i + 1];
    const x0 = xToPx(p0.x.getTime());
    const y0 = yToPy(p0.y);
    const x1 = xToPx(p1.x.getTime());
    const y1 = yToPy(p1.y);
    const mid = (Number(p0.y) + Number(p1.y)) / 2;
    let stroke = line;
    if (mid > 0) stroke = rgba(chargeRgb, 1);
    else if (mid < 0) stroke = rgba(dischargeRgb, 1);
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  const first = new Date(minX).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const last = new Date(maxX).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  ctx.fillStyle = text;
  ctx.textAlign = "left";
  ctx.fillText(first, pad.left, height - 8);
  ctx.textAlign = "right";
  ctx.fillText(last, width - pad.right, height - 8);
  ctx.textAlign = "left";
}

function powerChartExpanded() {
  const panel = $("powerChartFocus");
  return Boolean(panel && !panel.hidden);
}

function openPowerChartFocus() {
  const panel = $("powerChartFocus");
  if (!panel) return;
  panel.hidden = false;
  document.body.classList.add("chart-focus-open");
  updateCharts();
  $("powerChartFocusClose")?.focus();
}

function closePowerChartFocus() {
  const panel = $("powerChartFocus");
  if (!panel) return;
  panel.hidden = true;
  document.body.classList.remove("chart-focus-open");
  updateCharts();
}

function updateCharts() {
  const powerPoints = series(state.samples, "power_w");
  drawPowerChart("powerChart", powerPoints);
  if (powerChartExpanded()) {
    drawPowerChart("powerChartExpanded", powerPoints);
  }
  drawChart("percentChart", series(state.samples, "percent"), { min: 0, max: 100, digits: 0, color: "#bd5b2a" });
  drawChart("tempChart", series(state.samples, "temperature_c"), { digits: 1, color: "#6f6a28" });
}

async function refresh() {
  try {
    const [current, history] = await Promise.all([
      fetchJson("/api/current"),
      fetchJson(`/api/history?seconds=${state.seconds}`),
    ]);
    state.samples = history.samples || [];
    updateCurrent(current.sample, current.collector_error, current.collector_status, state.samples);
    updateCharts();
  } catch (error) {
    $("subtitle").textContent = error.message;
  }
}

document.querySelectorAll(".range").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".range").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.seconds = Number(button.dataset.seconds);
    refresh();
  });
});

window.addEventListener("resize", updateCharts);

$("powerChartExpandBtn")?.addEventListener("click", openPowerChartFocus);
$("powerChartFocusClose")?.addEventListener("click", closePowerChartFocus);
$("powerChartFocusBackdrop")?.addEventListener("click", closePowerChartFocus);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && powerChartExpanded()) closePowerChartFocus();
});

if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", invalidatePowerSwitchMarkerCache);
}

refresh();
setInterval(refresh, 5000);
