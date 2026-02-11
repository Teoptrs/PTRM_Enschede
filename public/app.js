const stopCountEl = document.getElementById("stop-count");
const lineCountEl = document.getElementById("line-count");
const vehicleCountEl = document.getElementById("vehicle-count");
const lastUpdatedEl = document.getElementById("last-updated");
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh-btn");

const refreshIntervalMs = 30000;
const stopDeparturesCacheTtlMs = 15000;
const stopDeparturesLimit = 6;
let vehicleTimer = null;
const stopDeparturesCache = new Map();

const map = L.map("map", {
  zoomControl: true,
});

map.createPane("boundary");
map.createPane("lines");
map.createPane("stops");
map.createPane("vehicles");

map.getPane("boundary").style.zIndex = 200;
map.getPane("lines").style.zIndex = 260;
map.getPane("stops").style.zIndex = 320;
map.getPane("vehicles").style.zIndex = 380;

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const boundaryLayer = L.geoJSON(null, {
  style: {
    color: "#1d4ed8",
    weight: 2,
    fillColor: "#60a5fa",
    fillOpacity: 0.08,
  },
  pane: "boundary",
}).addTo(map);

const stopsLayer = L.layerGroup().addTo(map);
const linesLayer = L.layerGroup().addTo(map);
const vehiclesLayer = L.layerGroup().addTo(map);

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatShortTime(ts) {
  if (!ts) return "-";
  const date = new Date(ts * 1000);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatCountdown(ts) {
  if (!ts) return "";
  const diffMs = ts * 1000 - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin <= 0) return "now";
  if (diffMin === 1) return "1 min";
  return `${diffMin} min`;
}

function buildStopPopup(
  stop,
  { loading, error, departures, approximate, distanceM } = {}
) {
  const title = escapeHtml(stop.name || "Stop");
  const stopId = escapeHtml(stop.id || "");
  let html = `<div class="stop-popup">`;
  html += `<div class="stop-popup-title">${title}</div>`;
  if (stopId) {
    html += `<div class="stop-popup-meta">Stop ${stopId}</div>`;
  }
  if (approximate && Number.isFinite(distanceM)) {
    const distanceLabel =
      distanceM >= 1000
        ? `${(distanceM / 1000).toFixed(1)} km`
        : `${distanceM} m`;
    html += `<div class="stop-popup-note">Using nearby timing point (${distanceLabel})</div>`;
  }

  if (loading) {
    html += `<div class="stop-popup-status">Loading departures...</div>`;
  } else if (error) {
    html += `<div class="stop-popup-status error">${escapeHtml(error)}</div>`;
  } else {
    const list = Array.isArray(departures) ? departures : [];
    if (list.length === 0) {
      html += `<div class="stop-popup-status">No upcoming departures.</div>`;
    } else {
      html += `<div class="stop-popup-list">`;
      list.slice(0, stopDeparturesLimit).forEach((departure) => {
        const line = escapeHtml(departure.lineNumber || "?");
        const destination = escapeHtml(departure.destination || "Unknown");
        const timeValue =
          departure.time || departure.expectedTime || departure.targetTime;
        const timeText = formatShortTime(timeValue);
        const countdown = formatCountdown(timeValue);
        const timeLabel = countdown
          ? `${timeText} · ${countdown}`
          : timeText;

        html += `
          <div class="stop-popup-row">
            <div class="stop-popup-line">${line}</div>
            <div class="stop-popup-dest" title="${destination}">${destination}</div>
            <div class="stop-popup-time">${timeLabel}</div>
          </div>
        `;
      });
      html += `</div>`;
    }
  }

  html += `</div>`;
  return html;
}

async function fetchStopDepartures(stopId) {
  if (!stopId) throw new Error("Missing stop ID.");
  const now = Date.now();
  const cached = stopDeparturesCache.get(stopId);
  if (cached && now - cached.timestamp < stopDeparturesCacheTtlMs) {
    return cached.data;
  }

  const res = await fetch(`/api/stops/${encodeURIComponent(stopId)}/departures`, {
    cache: "no-store",
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || "Failed to load departures.");
  }

  stopDeparturesCache.set(stopId, { timestamp: now, data: payload });
  return payload;
}

async function loadBoundary() {
  const res = await fetch("/api/boundary");
  if (!res.ok) throw new Error("Failed to load boundary");
  const boundary = await res.json();
  boundaryLayer.addData(boundary);
  map.fitBounds(boundaryLayer.getBounds(), { padding: [24, 24] });
  return boundary;
}

async function loadStops() {
  const res = await fetch("/api/stops");
  if (!res.ok) throw new Error("Failed to load stops");
  const data = await res.json();
  const stops = Array.isArray(data.stops) ? data.stops : [];
  stopCountEl.textContent = data.count ?? stops.length ?? "-";

  stopsLayer.clearLayers();
  stops.forEach((stop) => {
    const lat = Number(stop.lat);
    const lon = Number(stop.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const marker = L.circleMarker([lat, lon], {
      radius: 4,
      color: "#1f2937",
      weight: 1,
      fillColor: "#94a3b8",
      fillOpacity: 0.6,
      pane: "stops",
    });

    marker.bindPopup(buildStopPopup(stop, { loading: true }));
    marker.on("click", async () => {
      const popup = marker.getPopup();
      popup.setContent(buildStopPopup(stop, { loading: true }));
      marker.openPopup();

      try {
        const data = await fetchStopDepartures(stop.id);
        const departures = Array.isArray(data.departures) ? data.departures : [];
        popup.setContent(
          buildStopPopup(stop, {
            departures,
            approximate: data.approximate,
            distanceM: data.distanceM,
          })
        );
      } catch (err) {
        popup.setContent(
          buildStopPopup(stop, {
            error: err.message || "Failed to load departures.",
          })
        );
      }
    });
    marker.addTo(stopsLayer);
  });
}

async function loadLines() {
  const res = await fetch("/api/lines");
  if (!res.ok) throw new Error("Failed to load lines");
  const data = await res.json();
  const lines = Array.isArray(data.lines) ? data.lines : [];
  lineCountEl.textContent = data.count ?? lines.length ?? "-";

  linesLayer.clearLayers();
  lines.forEach((line) => {
    const coords = Array.isArray(line.coords) ? line.coords : [];
    if (coords.length < 2) return;
    const name = line.shortName || line.longName || line.routeId || "Bus line";
    const polyline = L.polyline(coords, {
      color: line.color || "#2563eb",
      weight: 3,
      opacity: 0.75,
      pane: "lines",
    }).bindPopup(`<strong>${escapeHtml(name)}</strong>`);
    polyline.addTo(linesLayer);
  });
}

function formatTimestamp(ts) {
  if (!ts) return "-";
  const date = new Date(ts * 1000);
  return date.toLocaleTimeString();
}

async function refreshVehicles() {
  const res = await fetch("/api/vehicles", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load vehicles");
  const data = await res.json();
  const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];

  vehiclesLayer.clearLayers();
  vehicles.forEach((vehicle) => {
    const lat = Number(vehicle.lat);
    const lon = Number(vehicle.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const label = String(vehicle.lineNumber || "").trim() || "?";
    const icon = L.divIcon({
      className: "bus-label",
      html: `<span>${escapeHtml(label)}</span>`,
      iconSize: [28, 22],
      iconAnchor: [14, 11],
    });

    const popupLabel = escapeHtml(
      vehicle.lineNumber || vehicle.lineName || "Unknown"
    );
    const marker = L.marker([lat, lon], {
      icon,
      pane: "vehicles",
    }).bindPopup(`<strong>Bus</strong><br />${popupLabel}`);
    marker.addTo(vehiclesLayer);
  });

  vehicleCountEl.textContent = vehicles.length;
  lastUpdatedEl.textContent = formatTimestamp(
    data.feedTimestamp || vehicles[0]?.timestamp
  );
}

async function init() {
  try {
    setStatus("Loading boundary...");
    await loadBoundary();
    setStatus("Loading stops...");
    await loadStops();
    setStatus("Loading lines...");
    await loadLines();
    setStatus("Loading vehicles...");
    await refreshVehicles();
    setStatus("Live");
  } catch (err) {
    setStatus(err.message || "Failed to load data", true);
    return;
  }

  vehicleTimer = setInterval(async () => {
    try {
      await refreshVehicles();
      setStatus("Live");
    } catch (err) {
      setStatus("Live feed error. Retrying...", true);
    }
  }, refreshIntervalMs);
}

refreshBtn.addEventListener("click", async () => {
  try {
    setStatus("Refreshing...");
    await refreshVehicles();
    setStatus("Live");
  } catch (err) {
    setStatus("Live feed error. Retrying...", true);
  }
});

init();
