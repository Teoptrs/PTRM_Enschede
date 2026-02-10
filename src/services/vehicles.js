const GtfsRealtimeBindings = require("gtfs-realtime-bindings");
const {
  VEHICLE_PROVIDER,
  VEHICLE_POS_SOURCE,
  OVAPI_BASE_URL,
  OVAPI_USER_AGENT,
  OVAPI_LINE_LIST_TTL_MS,
  OVAPI_ACTUALS_TTL_MS,
  OVAPI_BATCH_SIZE,
} = require("../config");
const { computeBBox, bboxContains, pointInGeometry } = require("../utils/geo");
const { getRouteMap, getTripMap } = require("./routes");
const { fetchTripUpdates } = require("./tripUpdates");
const { getLines } = require("./lines");

function normalizeLineNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^[0-9A-Za-z]+$/.test(raw)) return null;
  if (raw.length > 6) return null;
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return raw.toUpperCase();
}

function parseTimestamp(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

let ovapiLineCache = null;
let ovapiLineCacheTime = 0;

let ovapiActualsCache = null;
let ovapiActualsCacheTime = 0;
let ovapiActualsCacheKey = "";

async function fetchOvapiJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": OVAPI_USER_AGENT,
      Accept: "application/json",
      "Accept-Encoding": "gzip",
    },
  });
  if (!res.ok) {
    throw new Error(`OVapi request failed: ${res.status}`);
  }
  return res.json();
}

async function getOvapiLineList() {
  const now = Date.now();
  if (ovapiLineCache && now - ovapiLineCacheTime < OVAPI_LINE_LIST_TTL_MS) {
    return ovapiLineCache;
  }
  const base = normalizeBaseUrl(OVAPI_BASE_URL);
  const data = await fetchOvapiJson(`${base}/line/`);
  ovapiLineCache = data;
  ovapiLineCacheTime = now;
  return data;
}

async function getLocalLineNumbers(boundaryGeometry) {
  const result = await getLines(boundaryGeometry);
  const lines = Array.isArray(result) ? result : result.lines || [];
  const numbers = new Set();

  for (const line of lines) {
    const primary = normalizeLineNumber(line.shortName);
    if (primary) {
      numbers.add(primary);
      continue;
    }
    const fallback = normalizeLineNumber(line.routeId);
    if (fallback && /^\d+$/.test(fallback)) {
      numbers.add(fallback);
    }
  }

  return numbers;
}

function selectOvapiLineKeys(lineList, localLineNumbers) {
  const keys = [];
  for (const [key, info] of Object.entries(lineList || {})) {
    if (!info) continue;
    if (info.TransportType && info.TransportType !== "BUS") continue;
    const publicNumber = normalizeLineNumber(info.LinePublicNumber);
    if (!publicNumber) continue;
    if (!localLineNumbers.has(publicNumber)) continue;
    keys.push(key);
  }
  return keys;
}

async function fetchOvapiActuals(lineKeys) {
  const base = normalizeBaseUrl(OVAPI_BASE_URL);
  const batches = [];
  for (let i = 0; i < lineKeys.length; i += OVAPI_BATCH_SIZE) {
    batches.push(lineKeys.slice(i, i + OVAPI_BATCH_SIZE));
  }

  const merged = {};
  for (const batch of batches) {
    const joined = batch.map((key) => encodeURIComponent(key)).join(",");
    const data = await fetchOvapiJson(`${base}/line/${joined}`);
    Object.assign(merged, data);
  }
  return merged;
}

function parseOvapiActuals(actualsByLine, boundaryGeometry) {
  const bbox = computeBBox(boundaryGeometry);
  const vehicles = [];
  const seen = new Set();
  let latestTimestamp = 0;

  for (const lineData of Object.values(actualsByLine || {})) {
    const actuals = lineData?.Actuals || {};
    for (const [actualKey, actual] of Object.entries(actuals)) {
      const lat = Number(actual.latitude ?? actual.Latitude);
      const lon = Number(actual.longitude ?? actual.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const point = [lon, lat];
      if (!bboxContains(bbox, point)) continue;
      if (!pointInGeometry(point, boundaryGeometry)) continue;

      const id =
        actualKey ||
        [
          actual.DataOwnerCode,
          actual.JourneyNumber,
          actual.OperationDate,
        ]
          .filter(Boolean)
          .join("_");
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const lineNumber =
        normalizeLineNumber(actual.LinePublicNumber) ||
        normalizeLineNumber(actual.LinePlanningNumber) ||
        null;
      const lineName = actual.LineName || actual.DestinationName50 || null;
      const timestamp = parseTimestamp(
        actual.LastUpdateTimeStamp ||
          actual.ExpectedDepartureTime ||
          actual.ExpectedArrivalTime
      );

      if (timestamp && timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
      }

      vehicles.push({
        id,
        label: null,
        lineNumber,
        lineName,
        tripId: actual.JourneyNumber ?? null,
        routeId: actual.LinePlanningNumber ?? null,
        lat,
        lon,
        bearing: null,
        timestamp: timestamp ?? null,
      });
    }
  }

  return {
    feedTimestamp: latestTimestamp || null,
    vehicles,
  };
}

async function fetchVehiclesFromOvapi(boundaryGeometry) {
  const localLineNumbers = await getLocalLineNumbers(boundaryGeometry);
  if (localLineNumbers.size === 0) {
    console.warn("OVapi: no local line numbers found. Returning no vehicles.");
    return { feedTimestamp: null, vehicles: [] };
  }

  const lineList = await getOvapiLineList();
  const lineKeys = selectOvapiLineKeys(lineList, localLineNumbers);
  if (lineKeys.length === 0) {
    console.warn("OVapi: no matching lines found. Returning no vehicles.");
    return { feedTimestamp: null, vehicles: [] };
  }

  const sortedKeys = [...lineKeys].sort();
  const cacheKey = sortedKeys.join(",");
  const now = Date.now();
  if (
    ovapiActualsCache &&
    cacheKey === ovapiActualsCacheKey &&
    now - ovapiActualsCacheTime < OVAPI_ACTUALS_TTL_MS
  ) {
    return parseOvapiActuals(ovapiActualsCache, boundaryGeometry);
  }

  const actuals = await fetchOvapiActuals(sortedKeys);
  ovapiActualsCache = actuals;
  ovapiActualsCacheKey = cacheKey;
  ovapiActualsCacheTime = now;

  return parseOvapiActuals(actuals, boundaryGeometry);
}

async function fetchVehiclesFromGtfsRt(boundaryGeometry) {
  const bbox = computeBBox(boundaryGeometry);
  const routeMap = await getRouteMap();
  const tripMap = await getTripMap();
  let tripUpdates = null;

  try {
    tripUpdates = await fetchTripUpdates();
  } catch (err) {
    console.warn(`Trip updates unavailable (${err.message}).`);
  }

  const res = await fetch(VEHICLE_POS_SOURCE);
  if (!res.ok) {
    throw new Error(`Failed to download vehicle positions: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

  const vehicles = [];
  for (const entity of feed.entity) {
    if (!entity.vehicle || !entity.vehicle.position) continue;
    const lat = entity.vehicle.position.latitude;
    const lon = entity.vehicle.position.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const point = [lon, lat];
    if (!bboxContains(bbox, point)) continue;
    if (!pointInGeometry(point, boundaryGeometry)) continue;

    const vehicleId = entity.vehicle.vehicle?.id || entity.id || null;
    const rtMatch = vehicleId ? tripUpdates?.byVehicleId?.[vehicleId] : null;
    const tripId = entity.vehicle.trip?.trip_id || rtMatch?.tripId || null;
    const routeId = entity.vehicle.trip?.route_id || rtMatch?.routeId || null;
    const tripInfo = tripId ? tripMap[tripId] : null;
    const effectiveRouteId = routeId || tripInfo?.routeId || null;
    const routeInfo = effectiveRouteId ? routeMap[effectiveRouteId] : null;

    vehicles.push({
      id: vehicleId,
      label: entity.vehicle.vehicle?.label || null,
      lineNumber: routeInfo?.shortName || tripInfo?.shortName || null,
      lineName: routeInfo?.longName || tripInfo?.longName || null,
      tripId,
      routeId: effectiveRouteId,
      lat,
      lon,
      bearing: entity.vehicle.position.bearing ?? null,
      timestamp: entity.vehicle.timestamp
        ? Number(entity.vehicle.timestamp)
        : null,
    });
  }

  return {
    feedTimestamp: feed.header?.timestamp
      ? Number(feed.header.timestamp)
      : null,
    vehicles,
  };
}

async function fetchVehicles(boundaryGeometry) {
  if (VEHICLE_PROVIDER === "gtfs-rt") {
    return fetchVehiclesFromGtfsRt(boundaryGeometry);
  }
  return fetchVehiclesFromOvapi(boundaryGeometry);
}

module.exports = {
  fetchVehicles,
};
