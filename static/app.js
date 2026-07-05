const state = {
  seconds: 3600,
  samples: [],
  collectorStatus: null,
  powerFlowComponent: null,
  focusFlowComponent: null,
  focusedChart: null, // 'flow', 'power', 'temp', 'battery'
  currentView: 'live',
  batterySaver: false,
  reducedMotion: false,
  liveFlowVisible: true,
  idle: false,
  idleTimeoutMs: 20000,
  wasAutoPaused: false,
  lastInteractionTime: Date.now(),
  windowFocused: true,
  isMouseOver: false,
  isPluggedIn: false,
  lastRefreshTime: 0,
  chartHover: { canvasId: null, pointIndex: -1, point: null },
};

const TEMP_COMFORT_MAX_C = 38;
const BATTERY_SAVER_STORAGE_KEY = "chargio.batterySaver";
const IDLE_TIMEOUT_CHARGING_MS = 60000;
const IDLE_TIMEOUT_BATTERY_MS = 20000;
const IDLE_TIMEOUT_OBSERVATION_MS = 120000;
const POLL_TARGET_SECOND = 2; // Poll at :02 of each minute (1s after backend samples at :01)
let countdownIntervalId = null;

const $ = (id) => document.getElementById(id);

function fmt(value, suffix = "", digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function fmtInt(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Math.round(Number(value))}${suffix}`;
}

function secondsUntilNextPoll() {
  const s = new Date().getSeconds();
  return (POLL_TARGET_SECOND - s + 60) % 60;
}

function updateCountdownText() {
  const el = $("timeFooter");
  if (!el) return;

  const secs = secondsUntilNextPoll();
  const isFirstReading = state.samples.length === 0;

  if (secs === 0) {
    el.textContent = isFirstReading ? "Reading…" : "Updating…";
    el.className = "footer-updating";
  } else if (isFirstReading) {
    el.textContent = `First reading in ${secs}s`;
    el.className = "footer-first";
  } else {
    el.textContent = `Next update in ${secs}s`;
    el.className = "footer-quiet";
  }

  state.powerFlowComponent?.updateCountdown(secs);
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

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  if (ms === 0) return "0";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 1) return "<1s";
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

function formatGapMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  if (ms < 120000) return `${Math.round(ms / 1000)}s`;
  return formatDurationMs(ms);
}

function formatDeltaPercent(delta) {
  if (delta === null || delta === undefined || Number.isNaN(Number(delta))) return "--";
  const n = Number(delta);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function maxSampleGapMs(samples) {
  if (!samples || samples.length < 2) return null;
  let maxGap = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const dt = new Date(samples[i].sampled_at).getTime() - new Date(samples[i - 1].sampled_at).getTime();
    if (Number.isFinite(dt) && dt > maxGap) maxGap = dt;
  }
  return maxGap;
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

function initPowerFlow() {
  if (!state.powerFlowComponent && $("power-flow-container")) {
    state.powerFlowComponent = new PowerFlowComponent("power-flow-container", {
      isPluggedIn: false,
      batteryLevel: 50,
      isCharging: false,
      powerFlowIntensity: 1.0,
    });
    syncPowerFlowAnimationMode();
  }
}

function shouldAnimateLiveFlow() {
  return !state.batterySaver
    && !state.reducedMotion
    && !state.idle
    && !document.hidden
    && state.windowFocused
    && state.currentView === "live"
    && state.liveFlowVisible;
}

function shouldAnimateFocusFlow() {
  return !state.batterySaver
    && !state.reducedMotion
    && !state.idle
    && !document.hidden
    && state.windowFocused
    && state.focusedChart === "flow";
}

function syncPowerFlowAnimationMode() {
  const lowEnergy = state.batterySaver || state.reducedMotion;
  const liveEnabled = shouldAnimateLiveFlow();
  document.body.classList.toggle("battery-saver", lowEnergy);
  document.body.classList.toggle("ui-animations-paused", !liveEnabled);
  state.powerFlowComponent?.setBatterySaverMode(lowEnergy);
  state.powerFlowComponent?.setAnimationsEnabled(liveEnabled);
  state.focusFlowComponent?.setBatterySaverMode(lowEnergy);
  state.focusFlowComponent?.setAnimationsEnabled(shouldAnimateFocusFlow());
}

function setBatterySaver(enabled, persist = true) {
  state.batterySaver = Boolean(enabled);
  const toggle = $("batterySaverToggle");
  if (toggle) toggle.checked = state.batterySaver;
  if (persist) {
    try {
      window.localStorage?.setItem(BATTERY_SAVER_STORAGE_KEY, state.batterySaver ? "1" : "0");
    } catch (_error) {
      // Ignore storage failures; the in-memory setting still applies.
    }
  }
  syncPowerFlowAnimationMode();
}

function updatePowerFlow(sample, samples) {
  if (!sample) return;

  const wasPluggedIn = state.isPluggedIn;
  state.isPluggedIn = sample.external_connected === 1 || sample.external_connected === true;
  if (wasPluggedIn !== state.isPluggedIn) {
    resetAnimationIdleTimer();
  }

  let intensity = 1.0;
  if (sample.power_w && Math.abs(sample.power_w) > 50) {
    intensity = Math.min(Math.abs(sample.power_w) / 50, 2.0);
  }

  const unpluggedEstimate = estimateDischargeMinutes(sample, samples);
  let bestTimeEstimate = sample.time_remaining_min;
  if (!sample.external_connected && unpluggedEstimate !== null) {
    bestTimeEstimate = unpluggedEstimate;
  }

  const nextFlowState = {
    isPluggedIn: sample.external_connected === 1 || sample.external_connected === true,
    batteryLevel: Math.round(sample.percent ?? 50),
    isCharging: sample.is_charging === 1 || sample.is_charging === true,
    powerFlowIntensity: intensity,
    voltageMv: sample.voltage_mv,
    amperageMa: sample.amperage_ma,
    powerW: sample.power_w,
    systemPowerW: sample.system_power_w,
    adapterWatts: sample.adapter_watts,
    adapterVoltageMv: sample.adapter_voltage_mv,
    adapterCurrentMa: sample.adapter_current_ma,
    currentCapacityMah: sample.current_capacity,
    maxCapacityMah: sample.max_capacity,
    designCapacityMah: sample.design_capacity,
    temperatureC: sample.temperature_c,
    cycleCount: sample.cycle_count,
    timeRemainingMin: bestTimeEstimate,
    sampledAt: sample.sampled_at,
  };

  state.powerFlowComponent?.setState(nextFlowState);
  state.powerFlowComponent?.setLowPowerMode(!sample.external_connected || state.batterySaver || state.reducedMotion);
  syncPowerFlowAnimationMode();
}

function updateCurrent(sample, collectorError, collectorStatus, samples = []) {
  if (!sample) {
    $("subtitle").textContent = collectorError || "No samples yet";
    return;
  }

  if (!state.powerFlowComponent) {
    initPowerFlow();
  }
  updatePowerFlow(sample, samples);

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
  $("timeLabel").textContent = sample.external_connected ? "Time to full" : "Time remaining";
  const unpluggedEstimate = estimateDischargeMinutes(sample, samples);
  if (!sample.external_connected) {
    const estimate = unpluggedEstimate ?? sample.time_remaining_min;
    const label = minutesLabel(estimate);
    $("remaining").textContent = label === "--" ? "Calculating…" : label;
  } else {
    const label = minutesLabel(sample.time_remaining_min);
    $("remaining").textContent = label === "--" ? "Calculating…" : label;
  }
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

function batterySeries(samples) {
  if (!Array.isArray(samples)) return [];
  return samples
    .map((sample) => ({
      x: new Date(sample.sampled_at),
      y: sample.percent,
      isCharging: Boolean(sample.is_charging),
      externalConnected: Boolean(sample.external_connected),
    }))
    .filter((point) => point.y !== null && point.y !== undefined && !Number.isNaN(Number(point.y)));
}

function batterySegmentCategory(point) {
  if (point.isCharging) return "charge";
  if (!point.externalConnected) return "battery";
  return "external";
}

const chartDataCache = {};

function cacheChartData(canvasId, points, pad, plotW, plotH, minX, maxX, minY, maxY, extra) {
  chartDataCache[canvasId] = { points, pad, plotW, plotH, minX, maxX, minY, maxY, ...(extra || {}) };
}

function getCanvasMousePos(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top, rect };
}

function findNearestIndex(data, mx, my) {
  const { points, pad, plotW, plotH, minX, maxX, minY, maxY } = data;
  if (!points || points.length < 2) return -1;
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const px = pad.left + ((p.x.getTime() - minX) / Math.max(1, maxX - minX)) * plotW;
    const py = pad.top + (1 - ((Number(p.y) - minY) / (maxY - minY))) * plotH;
    const dx = mx - px;
    const dy = my - py;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  return bestDist <= 2500 ? bestIdx : -1;
}

function findNearestAdapterWatt(adapterPoints, timeMs) {
  if (!adapterPoints || adapterPoints.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const ap of adapterPoints) {
    const d = Math.abs(ap.x.getTime() - timeMs);
    if (d < bestDist) { bestDist = d; best = ap; }
  }
  return bestDist < 600000 ? best.y : null;
}

function formatTooltipText(point, canvasId, adapterPoints) {
  const time = point.x.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const val = Number(point.y).toFixed(1);
  let suffix = "";
  if (canvasId === "powerChart") suffix = " W";
  else if (canvasId === "percentChart") suffix = "%";
  else if (canvasId === "tempChart") suffix = " °C";
  else if (canvasId === "focusChartCanvas") {
    if (state.focusedChart === "power") suffix = " W";
    else if (state.focusedChart === "battery") suffix = "%";
    else if (state.focusedChart === "temp") suffix = " °C";
  }
  let result = `${time} · ${val}${suffix}`;
  if ((canvasId === "powerChart" || (canvasId === "focusChartCanvas" && state.focusedChart === "power")) && adapterPoints) {
    const adapterW = findNearestAdapterWatt(adapterPoints, point.x.getTime());
    if (adapterW !== null) {
      result += `  (adapter: ${adapterW.toFixed(0)} W)`;
    }
  }
  return result;
}

const $tooltip = () => document.getElementById("chartTooltip");

function showTooltip(event, text) {
  const el = $tooltip();
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  let left = event.clientX + 10;
  let top = event.clientY;
  const bw = el.offsetWidth;
  const bh = el.offsetHeight;
  if (left + bw > window.innerWidth - 10) left = event.clientX - bw - 10;
  if (top + bh / 2 > window.innerHeight - 10) top = window.innerHeight - 10 - bh / 2;
  if (top - bh / 2 < 10) top = 10 + bh / 2;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function hideTooltip() {
  const el = $tooltip();
  if (el) el.hidden = true;
}

function drawHoverOnChart(canvasId, ctx, pad, plotW, plotH) {
  const hover = state.chartHover;
  if (!hover || hover.canvasId !== canvasId || hover.pointIndex < 0) return;
  const data = chartDataCache[canvasId];
  if (!data || !data.points[hover.pointIndex]) return;
  const point = data.points[hover.pointIndex];
  const px = pad.left + ((point.x.getTime() - data.minX) / Math.max(1, data.maxX - data.minX)) * plotW;
  const py = pad.top + (1 - ((Number(point.y) - data.minY) / (data.maxY - data.minY))) * plotH;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(px, pad.top);
  ctx.lineTo(px, pad.top + plotH);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, 2 * Math.PI);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
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
  cacheChartData(canvasId, points, pad, plotW, plotH, minX, maxX, minY, maxY);
  drawHoverOnChart(canvasId, ctx, pad, plotW, plotH);
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

function expandTempPointsAtThreshold(points, threshold) {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    out.push(points[i]);
    if (i < points.length - 1) {
      const a = points[i];
      const b = points[i + 1];
      const y0 = Number(a.y);
      const y1 = Number(b.y);
      if (y0 !== y1 && (y0 - threshold) * (y1 - threshold) < 0) {
        const t0 = a.x.getTime();
        const t1 = b.x.getTime();
        const crossT = t0 + (t1 - t0) * ((y0 - threshold) / (y0 - y1));
        out.push({ x: new Date(crossT), y: threshold });
      }
    }
  }
  return out;
}

function drawPowerChart(canvasId, points, adapterPoints) {
  adapterPoints = adapterPoints || [];
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
  const adapterRgb = themeRgb("--adapter");

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
  const adapterYs = adapterPoints.map((p) => Number(p.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);

  let minY = Math.min(0, ...rawYs, ...adapterYs);
  let maxY = Math.max(0, ...rawYs, ...adapterYs);
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

  if (adapterPoints.length >= 2) {
    ctx.strokeStyle = rgba(adapterRgb, 0.9);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    let drawing = false;
    for (let i = 0; i < adapterPoints.length - 1; i += 1) {
      const p0 = adapterPoints[i];
      const p1 = adapterPoints[i + 1];
      const gap = p1.x.getTime() - p0.x.getTime();
      if (gap > 300000) {
        drawing = false;
        continue;
      }
      const x0 = xToPx(p0.x.getTime());
      const y0 = yToPy(p0.y);
      const x1 = xToPx(p1.x.getTime());
      const y1 = yToPy(p1.y);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  const first = new Date(minX).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const last = new Date(maxX).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  ctx.fillStyle = text;
  ctx.textAlign = "left";
  ctx.fillText(first, pad.left, height - 8);
  ctx.textAlign = "right";
  ctx.fillText(last, width - pad.right, height - 8);
  ctx.textAlign = "left";
  cacheChartData(canvasId, points, pad, plotW, plotH, minX, maxX, minY, maxY, { adapterPoints });
  drawHoverOnChart(canvasId, ctx, pad, plotW, plotH);
}

function drawBatteryChart(canvasId, points) {
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
  const onBatteryRgb = themeRgb("--warn");
  const externalRgb = themeRgb("--accent");
  const mutedRgb = themeRgb("--muted");

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

  const minX = Math.min(...points.map((p) => p.x.getTime()));
  const maxX = Math.max(...points.map((p) => p.x.getTime()));
  const minY = 0;
  const maxY = 100;

  const xToPx = (t) => pad.left + ((t - minX) / Math.max(1, maxX - minX)) * plotW;
  const yToPy = (y) => pad.top + (1 - ((Number(y) - minY) / (maxY - minY))) * plotH;

  const yTop = yToPy(100);
  const y80 = yToPy(80);
  const y20 = yToPy(20);
  const baseY = yToPy(0);

  function rgbForCategory(category) {
    if (category === "charge") return chargeRgb;
    if (category === "battery") return onBatteryRgb;
    return externalRgb;
  }

  function categoryAlongEdge(p0, p1) {
    const c0 = batterySegmentCategory(p0);
    const c1 = batterySegmentCategory(p1);
    return c0 === c1 ? c0 : c1;
  }

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
    ctx.fillText(`${Math.round(label)}%`, 6, y + 4);
  }

  ctx.fillStyle = rgba(chargeRgb, 0.06);
  ctx.fillRect(pad.left, yTop, plotW, Math.max(0, y80 - yTop));
  ctx.fillStyle = rgba(onBatteryRgb, 0.06);
  ctx.fillRect(pad.left, y20, plotW, Math.max(0, baseY - y20));

  ctx.save();
  ctx.strokeStyle = powerSwitchMarkerStrokeStyle();
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 6]);
  for (let i = 1; i < points.length; i += 1) {
    if (batterySegmentCategory(points[i - 1]) !== batterySegmentCategory(points[i])) {
      const x = xToPx(points[i].x.getTime());
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
    }
  }
  ctx.restore();

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const x0 = xToPx(p0.x.getTime());
    const x1 = xToPx(p1.x.getTime());
    const py0 = yToPy(p0.y);
    const py1 = yToPy(p1.y);
    const cat = categoryAlongEdge(p0, p1);
    ctx.fillStyle = rgba(rgbForCategory(cat), 0.18);
    ctx.beginPath();
    ctx.moveTo(x0, py0);
    ctx.lineTo(x1, py1);
    ctx.lineTo(x1, baseY);
    ctx.lineTo(x0, baseY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = rgba(mutedRgb, 0.35);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, y20);
  ctx.lineTo(width - pad.right, y20);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pad.left, y80);
  ctx.lineTo(width - pad.right, y80);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.lineWidth = 2;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const x0 = xToPx(p0.x.getTime());
    const py0 = yToPy(p0.y);
    const x1 = xToPx(p1.x.getTime());
    const py1 = yToPy(p1.y);
    const cat = categoryAlongEdge(p0, p1);
    ctx.strokeStyle = rgba(rgbForCategory(cat), 1);
    ctx.beginPath();
    ctx.moveTo(x0, py0);
    ctx.lineTo(x1, py1);
    ctx.stroke();
  }

  ctx.strokeStyle = text;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  ctx.moveTo(pad.left, baseY);
  ctx.lineTo(width - pad.right, baseY);
  ctx.stroke();
  ctx.fillStyle = text;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("0%", width - pad.right - 4, baseY - 5);
  ctx.textAlign = "left";
  ctx.font = "12px system-ui, sans-serif";

  const first = new Date(minX).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const last = new Date(maxX).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  ctx.fillStyle = text;
  ctx.fillText(first, pad.left, height - 8);
  ctx.textAlign = "right";
  ctx.fillText(last, width - pad.right, height - 8);
  ctx.textAlign = "left";
  cacheChartData(canvasId, points, pad, plotW, plotH, minX, maxX, 0, 100);
  drawHoverOnChart(canvasId, ctx, pad, plotW, plotH);
}

function drawTemperatureChart(canvasId, points) {
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
  const goodRgb = themeRgb("--good");
  const warnRgb = themeRgb("--warn");
  const mutedRgb = themeRgb("--muted");

  const safeC = TEMP_COMFORT_MAX_C;

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

  const ys = points.map((p) => Number(p.y));
  let minData = Math.min(...ys);
  let maxData = Math.max(...ys);
  if (minData === maxData) {
    minData -= 0.8;
    maxData += 0.8;
  }
  const yPad = Math.max((maxData - minData) * 0.12, 0.4);
  let minY = minData - yPad;
  let maxY = maxData + yPad;
  minY = Math.min(minY, safeC - 2);
  maxY = Math.max(maxY, safeC + 2);

  const expanded = expandTempPointsAtThreshold(points, safeC);
  const minX = Math.min(...expanded.map((p) => p.x.getTime()));
  const maxX = Math.max(...expanded.map((p) => p.x.getTime()));

  const xToPx = (t) => pad.left + ((t - minX) / Math.max(1, maxX - minX)) * plotW;
  const yToPy = (y) => pad.top + (1 - ((Number(y) - minY) / (maxY - minY))) * plotH;

  const baselineY = yToPy(minY);
  const ySafe = yToPy(safeC);

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
    ctx.fillText(`${label.toFixed(1)} °C`, 6, y + 4);
  }

  ctx.fillStyle = rgba(warnRgb, 0.08);
  ctx.fillRect(pad.left, pad.top, plotW, Math.max(0, ySafe - pad.top));
  ctx.fillStyle = rgba(goodRgb, 0.07);
  ctx.fillRect(pad.left, ySafe, plotW, Math.max(0, pad.top + plotH - ySafe));

  ctx.save();
  ctx.strokeStyle = powerSwitchMarkerStrokeStyle();
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 6]);
  for (let i = 1; i < points.length; i += 1) {
    const y0 = Number(points[i - 1].y);
    const y1 = Number(points[i].y);
    if (y0 !== y1 && (y0 - safeC) * (y1 - safeC) < 0) {
      const t0 = points[i - 1].x.getTime();
      const t1 = points[i].x.getTime();
      const crossT = t0 + (t1 - t0) * ((y0 - safeC) / (y0 - y1));
      const x = xToPx(crossT);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
    }
  }
  ctx.restore();

  for (let i = 0; i < expanded.length - 1; i += 1) {
    const p0 = expanded[i];
    const p1 = expanded[i + 1];
    const x0 = xToPx(p0.x.getTime());
    const x1 = xToPx(p1.x.getTime());
    const py0 = yToPy(p0.y);
    const py1 = yToPy(p1.y);
    const mid = (Number(p0.y) + Number(p1.y)) / 2;
    ctx.fillStyle = mid >= safeC ? rgba(warnRgb, 0.18) : rgba(goodRgb, 0.18);
    ctx.beginPath();
    ctx.moveTo(x0, py0);
    ctx.lineTo(x1, py1);
    ctx.lineTo(x1, baselineY);
    ctx.lineTo(x0, baselineY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = rgba(mutedRgb, 0.35);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, ySafe);
  ctx.lineTo(width - pad.right, ySafe);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.lineWidth = 2;
  for (let i = 0; i < expanded.length - 1; i += 1) {
    const p0 = expanded[i];
    const p1 = expanded[i + 1];
    const x0 = xToPx(p0.x.getTime());
    const py0 = yToPy(p0.y);
    const x1 = xToPx(p1.x.getTime());
    const py1 = yToPy(p1.y);
    const mid = (Number(p0.y) + Number(p1.y)) / 2;
    ctx.strokeStyle = mid >= safeC ? rgba(warnRgb, 1) : rgba(goodRgb, 1);
    ctx.beginPath();
    ctx.moveTo(x0, py0);
    ctx.lineTo(x1, py1);
    ctx.stroke();
  }

  ctx.strokeStyle = text;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(pad.left, baselineY);
  ctx.lineTo(width - pad.right, baselineY);
  ctx.stroke();
  ctx.fillStyle = text;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${safeC} °C`, width - pad.right - 4, ySafe - 5);
  ctx.textAlign = "left";
  ctx.font = "12px system-ui, sans-serif";

  const first = new Date(minX).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const last = new Date(maxX).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  ctx.fillStyle = text;
  ctx.fillText(first, pad.left, height - 8);
  ctx.textAlign = "right";
  ctx.fillText(last, width - pad.right, height - 8);
  ctx.textAlign = "left";
  cacheChartData(canvasId, points, pad, plotW, plotH, minX, maxX, minY, maxY);
  drawHoverOnChart(canvasId, ctx, pad, plotW, plotH);
}

function powerChartExpanded() {
  return state.focusedChart === 'power';
}

function openChartFocus(type) {
  const overlay = $("chartFocusOverlay");
  if (!overlay) return;

  state.focusedChart = type;
  overlay.hidden = false;
  document.body.classList.add("chart-focus-open");

  const canvas = $("focusChartCanvas");
  const flowContainer = $("focusFlowContainer");
  const title = $("chartFocusTitle");
  const subtitle = $("chartFocusSubtitle");
  const helpBtn = $("chartFocusHelpBtn");

  // Reset visibility
  canvas.hidden = true;
  flowContainer.hidden = true;
  flowContainer.innerHTML = '';
  if (state.focusFlowComponent) {
    state.focusFlowComponent.destroy();
    state.focusFlowComponent = null;
  }

  if (type === 'flow') {
    flowContainer.hidden = false;
    title.textContent = 'Battery Flow';
    subtitle.textContent = 'Live power path visualization';
    helpBtn.hidden = true;
    state.focusFlowComponent = new PowerFlowComponent("focusFlowContainer", {
      ...(state.powerFlowComponent ? state.powerFlowComponent.getState() : {}),
    });
    syncPowerFlowAnimationMode();
  } else {
    canvas.hidden = false;
    helpBtn.hidden = false;
    if (type === 'power') {
      title.textContent = 'Power History';
      subtitle.textContent = 'Battery power in Watts';
      helpBtn.dataset.legendHelp = 'powerLegendDialog';
    } else if (type === 'temp') {
      title.textContent = 'Temperature History';
      subtitle.textContent = 'Battery temperature in Celsius';
      helpBtn.dataset.legendHelp = 'tempLegendDialog';
    } else if (type === 'battery') {
      title.textContent = 'Battery Level History';
      subtitle.textContent = 'Charge percentage over time';
      helpBtn.dataset.legendHelp = 'batteryLegendDialog';
    }
  }

  updateCharts();
  $("chartFocusClose")?.focus();
}

function closeChartFocus() {
  const overlay = $("chartFocusOverlay");
  if (!overlay) return;
  overlay.hidden = true;
  document.body.classList.remove("chart-focus-open");
  state.focusedChart = null;
  if (state.focusFlowComponent) {
    state.focusFlowComponent.destroy();
    state.focusFlowComponent = null;
  }
  syncPowerFlowAnimationMode();
}

function adapterPowerSeries(samples) {
  const result = [];
  let lastValid = null;
  for (const s of samples) {
    const connected = s.external_connected === 1 || s.external_connected === true;
    const hasPower = s.system_power_w != null && s.system_power_w > 0;
    if (connected && hasPower) {
      lastValid = s.system_power_w;
      result.push({ x: new Date(s.sampled_at), y: s.system_power_w });
    } else if (connected && lastValid !== null) {
      result.push({ x: new Date(s.sampled_at), y: lastValid });
    } else if (!connected) {
      lastValid = null;
    }
  }
  return result;
}

let _chartRedrawScheduled = false;
function scheduleChartRedraw() {
  if (_chartRedrawScheduled || document.hidden) return;
  _chartRedrawScheduled = true;
  requestAnimationFrame(() => {
    _chartRedrawScheduled = false;
    updateCharts();
  });
}

function updateCharts() {
  const powerPoints = series(state.samples, "power_w");
  const adapterPoints = adapterPowerSeries(state.samples);
  drawPowerChart("powerChart", powerPoints, adapterPoints);

  const batteryPoints = batterySeries(state.samples);
  drawBatteryChart("percentChart", batteryPoints);
  
  const tempPoints = series(state.samples, "temperature_c");
  drawTemperatureChart("tempChart", tempPoints);

  if (state.focusedChart) {
    if (state.focusedChart === 'power') {
      drawPowerChart("focusChartCanvas", powerPoints, adapterPoints);
    } else if (state.focusedChart === 'temp') {
      drawTemperatureChart("focusChartCanvas", tempPoints);
    } else if (state.focusedChart === 'battery') {
      drawBatteryChart("focusChartCanvas", batteryPoints);
    } else if (state.focusedChart === 'flow' && state.focusFlowComponent && state.samples.length > 0) {
      const last = state.samples[state.samples.length - 1];
      const unpluggedEstimate = estimateDischargeMinutes(last, state.samples);
      let bestTimeEstimate = last.time_remaining_min;
      if (!last.external_connected && unpluggedEstimate !== null) {
        bestTimeEstimate = unpluggedEstimate;
      }
      
      let intensity = 1.0;
      if (last.power_w && Math.abs(last.power_w) > 50) {
        intensity = Math.min(Math.abs(last.power_w) / 50, 2.0);
      }

      state.focusFlowComponent.setState({
        isPluggedIn: last.external_connected === 1 || last.external_connected === true,
        batteryLevel: Math.round(last.percent ?? 50),
        isCharging: last.is_charging === 1 || last.is_charging === true,
        powerFlowIntensity: intensity,
        voltageMv: last.voltage_mv,
        amperageMa: last.amperage_ma,
        powerW: last.power_w,
        systemPowerW: last.system_power_w,
        adapterWatts: last.adapter_watts,
        adapterVoltageMv: last.adapter_voltage_mv,
        adapterCurrentMa: last.adapter_current_ma,
        currentCapacityMah: last.current_capacity,
        maxCapacityMah: last.max_capacity,
        designCapacityMah: last.design_capacity,
        temperatureC: last.temperature_c,
        cycleCount: last.cycle_count,
        timeRemainingMin: bestTimeEstimate,
        sampledAt: last.sampled_at,
      });
      state.focusFlowComponent.setLowPowerMode(!last.external_connected || state.batterySaver || state.reducedMotion);
      syncPowerFlowAnimationMode();
    }
  }
}

async function refresh() {
  try {
    const [current, history] = await Promise.all([
      fetchJson("/api/current"),
      fetchJson(`/api/history?seconds=${state.seconds}`),
    ]);
    state.samples = history.samples || [];
    state.collectorStatus = current.collector_status ?? null;
    updateCurrent(current.sample, current.collector_error, current.collector_status, state.samples);
    scheduleChartRedraw();
    state.lastRefreshTime = Date.now();
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

function setView(view, behavior = "smooth") {
  const target = view === "details" ? $("detailsView") : $("liveMode");
  if (!target) return;
  state.currentView = view;
  document.body.dataset.view = view;
  document.querySelectorAll(".view-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  syncPowerFlowAnimationMode();
  target.scrollIntoView({ behavior, block: "start" });
  window.setTimeout(updateCharts, behavior === "smooth" ? 420 : 0);
}

document.querySelectorAll(".view-option").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view || "live"));
});

$("liveMode")?.addEventListener("click", () => {
  if (state.currentView === "live") setView("details");
});

let lastLiveWheelAt = 0;
$("liveMode")?.addEventListener("wheel", (event) => {
  if (event.deltaY <= 18 || state.currentView !== "live") return;
  const now = Date.now();
  if (now - lastLiveWheelAt < 900) return;
  lastLiveWheelAt = now;
  setView("details");
}, { passive: true });

let touchStartY = null;
$("liveMode")?.addEventListener("touchstart", (event) => {
  touchStartY = event.touches[0]?.clientY ?? null;
}, { passive: true });

$("liveMode")?.addEventListener("touchend", (event) => {
  if (touchStartY === null) return;
  const endY = event.changedTouches[0]?.clientY ?? touchStartY;
  if (touchStartY - endY > 44 && state.currentView === "live") setView("details");
  touchStartY = null;
}, { passive: true });

window.addEventListener("scroll", () => {
  const details = $("detailsView");
  if (!details) return;
  const view = window.scrollY >= details.offsetTop - window.innerHeight * 0.4 ? "details" : "live";
  if (view === state.currentView) return;
  state.currentView = view;
  document.body.dataset.view = view;
  document.querySelectorAll(".view-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  syncPowerFlowAnimationMode();
}, { passive: true });

window.addEventListener("resize", scheduleChartRedraw);

document.querySelectorAll(".js-legend-help").forEach((button) => {
  button.addEventListener("click", () => {
    const id = button.dataset.legendHelp;
    const dialog = id ? $(id) : null;
    if (dialog && typeof dialog.showModal === "function") {
      dialog.showModal();
    }
  });
});

document.querySelectorAll(".chart-expand").forEach((button) => {
  button.addEventListener("click", () => {
    const type = button.dataset.expand;
    if (type) openChartFocus(type);
  });
});

$("chartFocusClose")?.addEventListener("click", closeChartFocus);
$("chartFocusBackdrop")?.addEventListener("click", closeChartFocus);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.focusedChart) closeChartFocus();
});

if (window.matchMedia) {
  const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  if (typeof colorSchemeQuery.addEventListener === "function") {
    colorSchemeQuery.addEventListener("change", invalidatePowerSwitchMarkerCache);
  } else if (typeof colorSchemeQuery.addListener === "function") {
    colorSchemeQuery.addListener(invalidatePowerSwitchMarkerCache);
  }
}

const reducedMotionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
if (reducedMotionQuery) {
  state.reducedMotion = reducedMotionQuery.matches;
  const handleReducedMotionChange = (event) => {
    state.reducedMotion = event.matches;
    syncPowerFlowAnimationMode();
  };
  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
  } else if (typeof reducedMotionQuery.addListener === "function") {
    reducedMotionQuery.addListener(handleReducedMotionChange);
  }
}

const savedBatterySaver = (() => {
  try {
    return window.localStorage?.getItem(BATTERY_SAVER_STORAGE_KEY);
  } catch (_error) {
    return null;
  }
})();
setBatterySaver(savedBatterySaver === null ? state.reducedMotion : savedBatterySaver === "1", false);

$("batterySaverToggle")?.addEventListener("change", (event) => {
  const enabled = event.currentTarget.checked;
  // Observation mode (longer timeout) only applies when plugged in
  if (!enabled && state.wasAutoPaused && state.isPluggedIn) {
    state.idleTimeoutMs = IDLE_TIMEOUT_OBSERVATION_MS;
  } else {
    state.idleTimeoutMs = state.isPluggedIn ? IDLE_TIMEOUT_CHARGING_MS : IDLE_TIMEOUT_BATTERY_MS;
  }
  state.wasAutoPaused = false;
  setBatterySaver(enabled);
  resetAnimationIdleTimer();
});

if ("IntersectionObserver" in window) {
  const liveObserver = new IntersectionObserver((entries) => {
    const entry = entries[0];
    state.liveFlowVisible = Boolean(entry?.isIntersecting);
    syncPowerFlowAnimationMode();
  }, { threshold: 0.08 });
  const live = $("liveMode");
  if (live) liveObserver.observe(live);
}

let idleTimer = null;
function resetAnimationIdleTimer() {
  state.idle = false;
  state.lastInteractionTime = Date.now();

  const currentDefaultTimeout = state.isPluggedIn ? IDLE_TIMEOUT_CHARGING_MS : IDLE_TIMEOUT_BATTERY_MS;
  // Strictly enforce battery timeout; observation mode is charging-only
  if (state.idleTimeoutMs !== IDLE_TIMEOUT_OBSERVATION_MS || !state.isPluggedIn) {
    state.idleTimeoutMs = currentDefaultTimeout;
  }

  if (state.wasAutoPaused && state.windowFocused && state.isMouseOver && state.isPluggedIn) {
    state.wasAutoPaused = false;
    setBatterySaver(false, false);
  }

  syncPowerFlowAnimationMode();
  if (idleTimer) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    state.idle = true;
    if (!state.batterySaver) {
      state.wasAutoPaused = true;
      setBatterySaver(true, false);
    }
    syncPowerFlowAnimationMode();
    state.idleTimeoutMs = currentDefaultTimeout;
  }, state.idleTimeoutMs);
}

function updateRefreshIndicator() {
  if (state.lastRefreshTime) {
    const elapsed = Date.now() - state.lastRefreshTime;
    const progress = Math.min(1, elapsed / 60000);
    state.powerFlowComponent?.updateRefreshRing(progress);
  }

  updateCountdownText();
  requestAnimationFrame(updateRefreshIndicator);
}

function updateIdleProgressBar() {
  const bar = $("idleProgress");
  if (!bar) return;

  if (state.idle || state.batterySaver || state.reducedMotion || !state.windowFocused || document.hidden) {
    bar.style.width = "0%";
    requestAnimationFrame(updateIdleProgressBar);
    return;
  }

  const elapsed = Date.now() - state.lastInteractionTime;
  const remaining = Math.max(0, 100 - (elapsed / state.idleTimeoutMs) * 100);
  bar.style.width = `${remaining}%`;
  requestAnimationFrame(updateIdleProgressBar);
}

["pointerdown", "keydown", "wheel", "touchstart", "scroll", "mousemove"].forEach((eventName) => {
  window.addEventListener(eventName, () => {
    if (state.isPluggedIn) resetAnimationIdleTimer();
  }, { passive: true });
});

window.addEventListener("mouseenter", () => {
  state.isMouseOver = true;
  if (state.isPluggedIn) resetAnimationIdleTimer();
});

window.addEventListener("mouseleave", () => {
  state.isMouseOver = false;
});

window.addEventListener("focus", () => {
  state.windowFocused = true;
  if (state.isPluggedIn) resetAnimationIdleTimer();
});

window.addEventListener("blur", () => {
  state.windowFocused = false;
  state.idle = true;
  if (!state.batterySaver) {
    state.wasAutoPaused = true;
    setBatterySaver(true, false);
  }
  syncPowerFlowAnimationMode();
});

document.addEventListener("visibilitychange", () => {
  syncPowerFlowAnimationMode();
  if (!document.hidden) {
    scheduleChartRedraw();
    if (state.isPluggedIn) resetAnimationIdleTimer();
  }
});

function setupChartInteraction(canvasId) {
  const canvas = $(canvasId);
  if (!canvas) return;
  canvas.addEventListener("mousemove", (event) => {
    const data = chartDataCache[canvasId];
    if (!data || !data.points || data.points.length < 2) return;
    const { x: mx, y: my } = getCanvasMousePos(canvas, event);
    const idx = findNearestIndex(data, mx, my);
    if (idx !== state.chartHover.pointIndex || state.chartHover.canvasId !== canvasId) {
      state.chartHover.canvasId = canvasId;
      state.chartHover.pointIndex = idx;
      state.chartHover.point = idx >= 0 ? data.points[idx] : null;
      if (idx >= 0) {
        showTooltip(event, formatTooltipText(data.points[idx], canvasId, data.adapterPoints));
      } else {
        hideTooltip();
      }
      scheduleChartRedraw();
    } else if (idx >= 0) {
      showTooltip(event, formatTooltipText(data.points[idx], canvasId, data.adapterPoints));
    }
  });
  canvas.addEventListener("mouseleave", () => {
    if (state.chartHover.canvasId === canvasId) {
      state.chartHover.canvasId = null;
      state.chartHover.pointIndex = -1;
      state.chartHover.point = null;
      hideTooltip();
      scheduleChartRedraw();
    }
  });
}

setupChartInteraction("powerChart");
setupChartInteraction("percentChart");
setupChartInteraction("tempChart");
setupChartInteraction("focusChartCanvas");

resetAnimationIdleTimer();
updateIdleProgressBar();
updateRefreshIndicator();
setView("live", "auto");

function startCountdownCycle() {
  refresh();
  countdownIntervalId = setInterval(() => {
    if (secondsUntilNextPoll() === 0) {
      refresh();
    }
  }, 1000);
}

startCountdownCycle();

window.addEventListener("beforeunload", () => {
  if (countdownIntervalId) clearInterval(countdownIntervalId);
});
