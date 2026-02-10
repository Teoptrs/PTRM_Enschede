const {
  BOUNDARY_CACHE,
  BOUNDARY_SOURCE,
  BOUNDARY_NAME,
  BOUNDARY_STATCODE,
} = require("../config");
const { ensureCacheDir, isFresh, loadJson, saveJson } = require("../utils/cache");
const { isLikelyWgs84 } = require("../utils/geo");

function buildQueryParams(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.join("&");
}

function matchesBoundary(feature) {
  const statnaam = String(feature?.properties?.statnaam || "")
    .toLowerCase()
    .trim();
  const statcode = String(feature?.properties?.statcode || "")
    .toUpperCase()
    .trim();
  const boundaryName = String(BOUNDARY_NAME || "").toLowerCase().trim();
  const boundaryStatcode = String(BOUNDARY_STATCODE || "")
    .toUpperCase()
    .trim();

  if (boundaryStatcode && statcode === boundaryStatcode) return true;
  if (!boundaryName) return false;
  return statnaam === boundaryName || statnaam.includes(boundaryName);
}

async function fetchBoundaryFromPdok() {
  const years = [2026, 2025, 2024, 2023];
  const baseParams = {
    f: "json",
    limit: 1000,
    crs: "EPSG:4326",
  };

  for (const year of years) {
    const params = buildQueryParams({ ...baseParams, jaarcode: year });
    const url = `${BOUNDARY_SOURCE}?${params}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    const matches = (data.features || []).filter(matchesBoundary);
    if (matches.length > 0) {
      const best = matches.reduce((a, b) =>
        Number(b.properties.jaarcode || 0) >
        Number(a.properties.jaarcode || 0)
          ? b
          : a
      );
      return best;
    }
  }

  let startIndex = 0;
  while (startIndex < 20000) {
    const params = buildQueryParams({
      ...baseParams,
      startindex: startIndex,
    });
    const url = `${BOUNDARY_SOURCE}?${params}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    const matches = (data.features || []).filter(matchesBoundary);
    if (matches.length > 0) {
      const best = matches.reduce((a, b) =>
        Number(b.properties.jaarcode || 0) >
        Number(a.properties.jaarcode || 0)
          ? b
          : a
      );
      return best;
    }
    if (!data.features || data.features.length === 0) break;
    startIndex += data.features.length;
  }

  throw new Error("Unable to find Enschede boundary from PDOK.");
}

async function getBoundary() {
  ensureCacheDir();
  if (isFresh(BOUNDARY_CACHE)) {
    return loadJson(BOUNDARY_CACHE);
  }
  const feature = await fetchBoundaryFromPdok();
  if (!isLikelyWgs84(feature.geometry)) {
    throw new Error("Boundary geometry CRS mismatch (expected EPSG:4326).");
  }
  saveJson(BOUNDARY_CACHE, feature);
  return feature;
}

module.exports = {
  getBoundary,
};
