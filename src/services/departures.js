const {
  OVAPI_BASE_URL,
  OVAPI_USER_AGENT,
  OVAPI_DEPARTURES_TTL_MS,
} = require("../config");

const departuresCache = new Map();

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

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

function extractTimes(pass) {
  const actual = parseTimestamp(
    pass.ActualDepartureTime || pass.ActualArrivalTime || null
  );
  const expected = parseTimestamp(
    pass.ExpectedDepartureTime || pass.ExpectedArrivalTime || null
  );
  const target = parseTimestamp(
    pass.TargetDepartureTime || pass.TargetArrivalTime || null
  );
  return {
    actualTime: actual,
    expectedTime: expected,
    targetTime: target,
    time: actual || expected || target,
  };
}

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

function pickStopAreaPayload(data, stopAreaCode) {
  if (!data || typeof data !== "object") return null;
  if (data[stopAreaCode]) return data[stopAreaCode];
  const lower = String(stopAreaCode || "").toLowerCase();
  if (data[lower]) return data[lower];
  const firstKey = Object.keys(data)[0];
  if (firstKey) return data[firstKey];
  return null;
}

function parseStopAreaDepartures(data, stopAreaCode) {
  const payload = pickStopAreaPayload(data, stopAreaCode);
  const departures = [];

  if (!payload || typeof payload !== "object") {
    return { stopAreaCode, departures };
  }

  for (const timingPoint of Object.values(payload)) {
    if (!timingPoint || typeof timingPoint !== "object") continue;
    const timingPointName =
      timingPoint.TimingPointName ||
      timingPoint.TimingPointName50 ||
      timingPoint.TimingPointCode ||
      null;
    const passes = timingPoint.Passes || timingPoint.Departures || {};

    for (const pass of Object.values(passes)) {
      if (!pass || typeof pass !== "object") continue;

      const lineNumber = normalizeLineNumber(
        pass.LinePublicNumber || pass.LinePlanningNumber || null
      );
      const destination =
        pass.DestinationName50 ||
        pass.DestinationName ||
        pass.LineName ||
        null;
      const times = extractTimes(pass);

      departures.push({
        lineNumber,
        destination,
        timingPointName,
        journeyNumber: pass.JourneyNumber || null,
        stopStatus: pass.TripStopStatus || null,
        ...times,
      });
    }
  }

  departures.sort((a, b) => {
    const aTime = a.time ?? Number.POSITIVE_INFINITY;
    const bTime = b.time ?? Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });

  return { stopAreaCode, departures };
}

async function fetchStopAreaDepartures(stopAreaCode) {
  const code = String(stopAreaCode || "").trim();
  if (!code) {
    throw new Error("Missing stop area code.");
  }

  const now = Date.now();
  const cached = departuresCache.get(code);
  if (cached && now - cached.timestamp < OVAPI_DEPARTURES_TTL_MS) {
    return cached.data;
  }

  const base = normalizeBaseUrl(OVAPI_BASE_URL);
  const url = `${base}/stopareacode/${encodeURIComponent(code)}/departures`;
  const data = await fetchOvapiJson(url);
  const parsed = parseStopAreaDepartures(data, code);

  departuresCache.set(code, { timestamp: now, data: parsed });
  return parsed;
}

module.exports = {
  fetchStopAreaDepartures,
};
