/* ==========================================================================
   Sahaara AI — API client
   ========================================================================== */

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function request(url, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError("Cannot reach the Sahaara API. Is `npm start` running?", 0, null);
  }

  let payload = null;
  const text = await res.text();
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

  if (!res.ok) {
    const msg =
      (payload && (payload.error || payload.message)) ||
      `Request failed with ${res.status}`;
    throw new ApiError(msg, res.status, payload);
  }
  return payload;
}

export const api = {
  health: (signal) => request("/api/health", { signal }),

  fixtures: (signal) => request("/api/fixtures", { signal }),

  /** Run a single fixture through the full pipeline. */
  runFixture: (id, signal) =>
    request(`/api/fixtures/${encodeURIComponent(id)}`, { method: "POST", signal }),

  /** Free-form assessment (used by the manual input + degraded mode). */
  assess: (input, signal) =>
    request("/api/assess", { method: "POST", body: { input }, signal }),

  /** Submit a human review against an AI assessment. */
  review: (assessment, review, signal) =>
    request("/api/review", { method: "POST", body: { assessment, review }, signal }),

  audit: (caseRef, signal) =>
    request(caseRef ? `/api/audit/${encodeURIComponent(caseRef)}` : "/api/audit", { signal }),

  cases: (signal) => request("/api/cases", { signal }),

  case: (ref, signal) => request(`/api/cases/${encodeURIComponent(ref)}`, { signal }),

  /** Circuit-breaker kill switch: {"state":"OFFLINE"|"HEALTHY"} */
  service: (state, signal) =>
    request("/api/service", { method: "POST", body: { state }, signal }),
};

export { ApiError };
