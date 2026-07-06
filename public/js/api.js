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
export async function apiGetBlob(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: authHeaders(
      options.headers instanceof Headers
        ? Object.fromEntries(options.headers.entries())
        : { ...(options.headers ?? {}) },
    ),
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Fout ${res.status}`);
  }
  return res.blob();
}

function isNetworkFetchError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
}

/** @param {unknown} err */
export function formatApiNetworkError(err) {
  if (isNetworkFetchError(err)) {
    return (
      "Geen verbinding met MegaMinnie (time-out of netwerk). " +
      "Controleer je internet en of de server nog draait. " +
      "Lange gespreksopnames kunnen enkele minuten duren — probeer opnieuw."
    );
  }
  return err instanceof Error ? err.message : String(err ?? "Onbekende fout");
}

/** @param {string} path @param {RequestInit} [options] */
export async function apiPost(path, options = {}) {
  const headers = authHeaders(
    options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : { ...(options.headers ?? {}) },
  );

  let res;
  try {
    res = await fetch(path, { ...options, headers, cache: "no-store" });
  } catch (err) {
    throw new Error(formatApiNetworkError(err));
  }
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
