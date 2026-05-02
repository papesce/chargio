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

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function updateCurrent(sample, collectorError) {
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
  $("remaining").textContent = minutesLabel(sample.time_remaining_min);
  $("sampled").textContent = `sampled ${localTime(sample.sampled_at)}`;
  $("subtitle").textContent = collectorError || `Last sample ${localTime(sample.sampled_at)}`;
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

function updateCharts() {
  drawChart("powerChart", series(state.samples, "power_w"), { digits: 1 });
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
    updateCurrent(current.sample, current.collector_error);
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
refresh();
setInterval(refresh, 5000);
