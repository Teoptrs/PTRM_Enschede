const zlib = require("zlib");
const csv = require("csv-parser");
const { Readable } = require("stream");
const { STOPS_CACHE, STOPS_SOURCE } = require("../config");
const { ensureCacheDir, isFresh, loadJson, saveJson } = require("../utils/cache");
const { computeBBox, bboxContains, pointInGeometry } = require("../utils/geo");
const { openGtfsZip, getZipEntry } = require("./gtfs");

function parseStopRow(row, bbox, boundaryGeometry, stops) {
  const lat = Number(row.stop_lat);
  const lon = Number(row.stop_lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const locationType = String(row.location_type || "").trim();
  if (locationType && locationType !== "0") return;

  const point = [lon, lat];
  if (!bboxContains(bbox, point)) return;
  if (!pointInGeometry(point, boundaryGeometry)) return;

  stops.push({
    id: row.stop_id,
    name: row.stop_name,
    lat,
    lon,
  });
}

async function buildStopsFromCsvGz(boundaryGeometry) {
  const bbox = computeBBox(boundaryGeometry);
  const stops = [];

  const res = await fetch(STOPS_SOURCE);
  if (!res.ok) {
    throw new Error(`Failed to download stops: ${res.status}`);
  }

  await new Promise((resolve, reject) => {
    const input = Readable.fromWeb(res.body);
    const gunzip = zlib.createGunzip();
    const parser = csv();

    parser.on("data", (row) => {
      parseStopRow(row, bbox, boundaryGeometry, stops);
    });

    parser.on("end", resolve);
    parser.on("error", reject);

    input.pipe(gunzip).pipe(parser);
  });

  return stops;
}

async function buildStopsFromGtfs(boundaryGeometry) {
  const bbox = computeBBox(boundaryGeometry);
  const stops = [];
  const zip = await openGtfsZip();
  const stopsEntry = getZipEntry(zip, "stops.txt");

  if (!stopsEntry) {
    throw new Error("Missing required GTFS file (stops.txt).");
  }

  await new Promise((resolve, reject) => {
    stopsEntry
      .stream()
      .pipe(csv())
      .on("data", (row) => {
        parseStopRow(row, bbox, boundaryGeometry, stops);
      })
      .on("end", resolve)
      .on("error", reject);
  });

  return stops;
}

async function getStops(boundaryGeometry) {
  ensureCacheDir();
  if (isFresh(STOPS_CACHE)) {
    return loadJson(STOPS_CACHE);
  }
  let stops = [];
  try {
    stops = await buildStopsFromCsvGz(boundaryGeometry);
  } catch (err) {
    console.warn(
      `Stops CSV failed (${err.message}). Falling back to GTFS static.`
    );
    stops = await buildStopsFromGtfs(boundaryGeometry);
  }
  saveJson(STOPS_CACHE, stops);
  return stops;
}

module.exports = {
  getStops,
};
