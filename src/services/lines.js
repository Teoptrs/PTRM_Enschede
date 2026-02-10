const csv = require("csv-parser");
const { openGtfsZip, getZipEntry } = require("./gtfs");
const { LINES_CACHE, LINES_SOURCE, OVERPASS_URL } = require("../config");
const { ensureCacheDir, isFresh, loadJson, saveJson } = require("../utils/cache");
const { computeBBox, bboxContains, pointInGeometry } = require("../utils/geo");
const { colorFromId } = require("../utils/color");

function clipPolylineToBoundary(coords, boundaryGeometry, bbox) {
  const segments = [];
  let current = [];

  for (const point of coords) {
    const inside =
      bboxContains(bbox, [point.lon, point.lat]) &&
      pointInGeometry([point.lon, point.lat], boundaryGeometry);
    if (inside) {
      current.push([point.lat, point.lon]);
    } else if (current.length >= 2) {
      segments.push(current);
      current = [];
    } else {
      current = [];
    }
  }

  if (current.length >= 2) segments.push(current);
  return segments;
}

async function buildLinesFromGtfs(boundaryGeometry) {
  const bbox = computeBBox(boundaryGeometry);
  const zip = await openGtfsZip();

  const routesEntry = getZipEntry(zip, "routes.txt");
  const tripsEntry = getZipEntry(zip, "trips.txt");
  const shapesEntry = getZipEntry(zip, "shapes.txt");

  if (!routesEntry || !tripsEntry || !shapesEntry) {
    throw new Error("Missing required GTFS files (routes, trips, shapes).");
  }

  const routes = new Map();
  await new Promise((resolve, reject) => {
    routesEntry
      .stream()
      .pipe(csv())
      .on("data", (row) => {
        const routeType = Number(row.route_type);
        const isBus =
          routeType === 3 || (routeType >= 700 && routeType < 800);
        if (!isBus) return;
        const color = row.route_color
          ? `#${String(row.route_color).trim()}`
          : null;
        const textColor = row.route_text_color
          ? `#${String(row.route_text_color).trim()}`
          : null;
        routes.set(row.route_id, {
          id: row.route_id,
          shortName: row.route_short_name || "",
          longName: row.route_long_name || "",
          color,
          textColor,
          type: routeType,
        });
      })
      .on("end", resolve)
      .on("error", reject);
  });

  const shapeToRoutes = new Map();
  await new Promise((resolve, reject) => {
    tripsEntry
      .stream()
      .pipe(csv())
      .on("data", (row) => {
        if (!routes.has(row.route_id)) return;
        const shapeId = row.shape_id;
        if (!shapeId) return;
        if (!shapeToRoutes.has(shapeId)) {
          shapeToRoutes.set(shapeId, new Set());
        }
        shapeToRoutes.get(shapeId).add(row.route_id);
      })
      .on("end", resolve)
      .on("error", reject);
  });

  const shapes = new Map();
  await new Promise((resolve, reject) => {
    shapesEntry
      .stream()
      .pipe(csv())
      .on("data", (row) => {
        const shapeId = row.shape_id;
        if (!shapeToRoutes.has(shapeId)) return;
        const lat = Number(row.shape_pt_lat);
        const lon = Number(row.shape_pt_lon);
        const seq = Number(row.shape_pt_sequence);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const entry = shapes.get(shapeId) || {
          points: [],
        };
        entry.points.push({ lat, lon, seq });
        shapes.set(shapeId, entry);
      })
      .on("end", resolve)
      .on("error", reject);
  });

  const lines = [];
  for (const [shapeId, entry] of shapes.entries()) {
    entry.points.sort((a, b) => a.seq - b.seq);
    const segments = clipPolylineToBoundary(entry.points, boundaryGeometry, bbox);
    if (segments.length === 0) continue;

    const routeIds = shapeToRoutes.get(shapeId) || new Set();
    for (const routeId of routeIds) {
      const route = routes.get(routeId);
      if (!route) continue;
      for (let i = 0; i < segments.length; i += 1) {
        lines.push({
          shapeId,
          segmentIndex: i,
          routeId,
          shortName: route.shortName,
          longName: route.longName,
          color: route.color || colorFromId(routeId),
          textColor: route.textColor || "#ffffff",
          coords: segments[i],
        });
      }
    }
  }

  return lines;
}

async function buildLinesFromOverpass(boundaryGeometry) {
  const bbox = computeBBox(boundaryGeometry);
  const bboxString = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  const query = `
    [out:json][timeout:25];
    (
      relation["route"="bus"](${bboxString});
    );
    out body;
    >;
    out geom;
  `;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) {
    throw new Error(`Overpass failed: ${res.status}`);
  }

  const data = await res.json();
  const elements = data.elements || [];
  const ways = new Map();
  const relations = [];

  for (const el of elements) {
    if (el.type === "way" && Array.isArray(el.geometry)) {
      ways.set(el.id, el);
    } else if (el.type === "relation") {
      relations.push(el);
    }
  }

  const lines = [];
  for (const rel of relations) {
    const tags = rel.tags || {};
    const color =
      tags.colour ||
      tags["colour:line"] ||
      tags["route:colour"] ||
      null;
    const routeId = tags.ref || rel.id;
    const name = tags.name || tags.ref || "Bus line";
    const members = rel.members || [];

    for (const member of members) {
      if (member.type !== "way") continue;
      const way = ways.get(member.ref);
      if (!way || !Array.isArray(way.geometry)) continue;

      const points = way.geometry.map((p) => ({ lat: p.lat, lon: p.lon }));
      const segments = clipPolylineToBoundary(points, boundaryGeometry, bbox);
      for (let i = 0; i < segments.length; i += 1) {
        lines.push({
          source: "overpass",
          relationId: rel.id,
          routeId,
          shortName: tags.ref || "",
          longName: tags.name || "",
          color: color || colorFromId(routeId),
          coords: segments[i],
          name,
        });
      }
    }
  }

  return lines;
}

async function getLines(boundaryGeometry) {
  ensureCacheDir();
  if (isFresh(LINES_CACHE)) {
    const cached = loadJson(LINES_CACHE);
    if (Array.isArray(cached)) {
      return { lines: cached, source: LINES_SOURCE };
    }
    return cached;
  }
  let lines = [];
  let source = LINES_SOURCE;

  if (LINES_SOURCE === "overpass") {
    try {
      lines = await buildLinesFromOverpass(boundaryGeometry);
    } catch (err) {
      console.warn(`Overpass failed (${err.message}). Falling back to GTFS.`);
      lines = await buildLinesFromGtfs(boundaryGeometry);
      source = "gtfs";
    }
  } else {
    lines = await buildLinesFromGtfs(boundaryGeometry);
    source = "gtfs";
  }

  const payload = { lines, source };
  saveJson(LINES_CACHE, payload);
  return payload;
}

module.exports = {
  getLines,
};
