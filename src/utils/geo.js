function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] <
        ((xj - xi) * (point[1] - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(point, polygon[i])) return false;
  }
  return true;
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    return pointInPolygon(point, geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((poly) => pointInPolygon(point, poly));
  }
  return false;
}

function computeBBox(geometry) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const visit = (coords) => {
    if (typeof coords[0] === "number") {
      const [lon, lat] = coords;
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
      return;
    }
    for (const c of coords) visit(c);
  };

  visit(geometry.coordinates);
  return { minLon, minLat, maxLon, maxLat };
}

function bboxContains(bbox, point) {
  return (
    point[0] >= bbox.minLon &&
    point[0] <= bbox.maxLon &&
    point[1] >= bbox.minLat &&
    point[1] <= bbox.maxLat
  );
}

function isLikelyWgs84(geometry) {
  const bbox = computeBBox(geometry);
  return (
    bbox.minLon >= -180 &&
    bbox.maxLon <= 180 &&
    bbox.minLat >= -90 &&
    bbox.maxLat <= 90
  );
}

function computeBBoxFromCoords(coords) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const point of coords) {
    const lat = point[0];
    const lon = point[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return { minLon, minLat, maxLon, maxLat };
}

function distancePointToSegmentMeters(lat, lon, lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const meanLat = (lat1 + lat2) / 2;
  const cosLat = Math.cos(meanLat * rad);
  const ax = (lon - lon1) * cosLat;
  const ay = lat - lat1;
  const bx = (lon2 - lon1) * cosLat;
  const by = lat2 - lat1;
  const dot = ax * bx + ay * by;
  const lenSq = bx * bx + by * by;
  let t = lenSq > 0 ? dot / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const projX = bx * t;
  const projY = by * t;
  const dx = ax - projX;
  const dy = ay - projY;
  const metersPerDegree = 111320;
  return Math.sqrt(dx * dx + dy * dy) * metersPerDegree;
}

function distancePointToPolylineMeters(lat, lon, coords) {
  if (!coords || coords.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const d = distancePointToSegmentMeters(
      lat,
      lon,
      p1[0],
      p1[1],
      p2[0],
      p2[1]
    );
    if (d < min) min = d;
  }
  return min;
}

function distanceBetweenPointsMeters(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return Infinity;
  }
  const rad = Math.PI / 180;
  const meanLat = (lat1 + lat2) / 2;
  const cosLat = Math.cos(meanLat * rad);
  const dx = (lon2 - lon1) * cosLat;
  const dy = lat2 - lat1;
  const metersPerDegree = 111320;
  return Math.sqrt(dx * dx + dy * dy) * metersPerDegree;
}

module.exports = {
  pointInGeometry,
  computeBBox,
  bboxContains,
  isLikelyWgs84,
  computeBBoxFromCoords,
  distancePointToPolylineMeters,
  distanceBetweenPointsMeters,
};
