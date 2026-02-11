const csv = require("csv-parser");
const {
  STOPAREAS_CACHE,
  STOPAREA_MATCH_RADIUS_M,
  OVAPI_BASE_URL,
  OVAPI_USER_AGENT,
  OVAPI_STOPAREAS_TTL_MS,
} = require("../config");
const { ensureCacheDir, isFresh, loadJson, saveJson } = require("../utils/cache");
const {
  computeBBox,
  bboxContains,
  distanceBetweenPointsMeters,
} = require("../utils/geo");
const { openGtfsZip, getZipEntry } = require("./gtfs");

function normalizeStopArea(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.toLowerCase().startsWith("stoparea:")) {
    return raw.slice("stoparea:".length);
  }
  return raw;
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function fetchOvapiStopAreas() {
  const base = normalizeBaseUrl(OVAPI_BASE_URL);
  const res = await fetch(`${base}/stopareacode/`, {
    headers: {
      "User-Agent": OVAPI_USER_AGENT,
      Accept: "application/json",
      "Accept-Encoding": "gzip",
    },
  });
  if (!res.ok) {
    throw new Error(`OVapi request failed: ${res.status}`);
  }

  const data = await res.json();
  const areas = [];
  for (const [code, info] of Object.entries(data || {})) {
    if (!info) continue;
    const lat = Number(info.Latitude ?? info.latitude);
    const lon = Number(info.Longitude ?? info.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    areas.push({
      code: String(code),
      lat,
      lon,
      name: info.TimingPointName || null,
      town: info.TimingPointTown || null,
    });
  }
  return areas;
}

function filterAreasToBoundary(areas, boundaryGeometry) {
  const bbox = computeBBox(boundaryGeometry);
  const margin = STOPAREA_MATCH_RADIUS_M / 111320;
  const expanded = {
    minLon: bbox.minLon - margin,
    maxLon: bbox.maxLon + margin,
    minLat: bbox.minLat - margin,
    maxLat: bbox.maxLat + margin,
  };

  return areas.filter((area) => {
    const point = [area.lon, area.lat];
    if (!bboxContains(expanded, point)) return false;
    return true;
  });
}

async function buildStopAreaIndex(boundaryGeometry) {
  const zip = await openGtfsZip();
  const stopsEntry = getZipEntry(zip, "stops.txt");
  if (!stopsEntry) {
    throw new Error("Missing required GTFS file (stops.txt).");
  }

  const byStopId = {};
  await new Promise((resolve, reject) => {
    stopsEntry
      .stream()
      .pipe(csv())
      .on("data", (row) => {
        const stopId = row.stop_id;
        if (!stopId) return;
        const stopAreaCode = normalizeStopArea(row.parent_station);
        if (!stopAreaCode) return;
        byStopId[stopId] = stopAreaCode;
      })
      .on("end", resolve)
      .on("error", reject);
  });

  let ovapiStopAreas = [];
  try {
    const areas = await fetchOvapiStopAreas();
    ovapiStopAreas = filterAreasToBoundary(areas, boundaryGeometry);
  } catch (err) {
    console.warn(`OVapi stoparea list unavailable (${err.message}).`);
  }

  return { byStopId, ovapiStopAreas, ovapiStopAreasUpdatedAt: Date.now() };
}

function isValidIndex(payload) {
  return (
    payload &&
    typeof payload === "object" &&
    payload.byStopId &&
    Array.isArray(payload.ovapiStopAreas)
  );
}

async function getStopAreaIndex(boundaryGeometry) {
  ensureCacheDir();
  if (isFresh(STOPAREAS_CACHE)) {
    const cached = loadJson(STOPAREAS_CACHE);
    if (isValidIndex(cached)) {
      const tooOld =
        !cached.ovapiStopAreasUpdatedAt ||
        Date.now() - cached.ovapiStopAreasUpdatedAt > OVAPI_STOPAREAS_TTL_MS;
      if (!tooOld) {
        return cached;
      }
      const refreshed = await buildStopAreaIndex(boundaryGeometry);
      const merged = {
        byStopId: cached.byStopId || refreshed.byStopId,
        ovapiStopAreas: refreshed.ovapiStopAreas,
        ovapiStopAreasUpdatedAt: refreshed.ovapiStopAreasUpdatedAt,
      };
      saveJson(STOPAREAS_CACHE, merged);
      return merged;
    }
  }
  const index = await buildStopAreaIndex(boundaryGeometry);
  saveJson(STOPAREAS_CACHE, index);
  return index;
}

function findNearestStopArea(lat, lon, areaStops) {
  let best = null;
  let bestDist = Infinity;

  for (const stop of areaStops) {
    const dist = distanceBetweenPointsMeters(lat, lon, stop.lat, stop.lon);
    if (dist < bestDist) {
      bestDist = dist;
      best = stop;
    }
  }

  if (!best) return null;
  const code = best.code || best.stopAreaCode || null;
  if (!code) return null;
  return {
    code,
    distanceM: Math.round(bestDist),
    approximate: bestDist > STOPAREA_MATCH_RADIUS_M,
  };
}

async function resolveStopArea(stopId, lat, lon, boundaryGeometry) {
  if (!stopId || !boundaryGeometry) return null;
  const index = await getStopAreaIndex(boundaryGeometry);
  if (index.byStopId[stopId]) {
    return { code: index.byStopId[stopId], distanceM: 0, approximate: false };
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return findNearestStopArea(lat, lon, index.ovapiStopAreas || []);
}

module.exports = {
  resolveStopArea,
};
