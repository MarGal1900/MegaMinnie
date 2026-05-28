let apiKey = null;

/** @param {string | null} key */
export function setApiKey(key) {
  apiKey = key?.trim() || null;
}

function authHeaders(extra = {}) {
  if (!apiKey) return extra;
  return { ...extra, "X-API-Key": apiKey };
}

/** @param {string} path @param {RequestInit} [options] */
export async function apiPost(path, options = {}) {
  const headers = authHeaders(
    options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : { ...(options.headers ?? {}) },
  );

  const res = await fetch(path, { ...options, headers, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fout ${res.status}`);
  return data;
}

export function formFields() {
  return new FormData();
}

/** @param {string} path @param {Record<string, unknown>} body */
export async function apiPostBlob(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Fout ${res.status}`);
  }
  return res.blob();
}
