/** @param {string} id */
export const $ = (id) => document.getElementById(id);

/** @param {string} str */
export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string} iso */
export function formatDate(iso) {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/** @param {string} start @param {string} end */
export function formatDateTimeRange(start, end) {
  try {
    const s = new Date(start);
    const e = new Date(end);
    const date = s.toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
    });
    const time = `${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })} – ${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
    return `${date}, ${time}`;
  } catch {
    return `${start} – ${end}`;
  }
}

/** @param {string} iso */
export function toDatetimeLocalValue(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

/** @param {string} local */
export function fromDatetimeLocalValue(local) {
  if (!local) return "";
  try {
    return new Date(local).toISOString();
  } catch {
    return local;
  }
}

/** @param {string} msg @param {"success"|"error"|"warning"} type */
export function showFeedback(msg, type) {
  const el = $("sync-feedback");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.className = `feedback is-${type}`;
}

export function hideFeedback() {
  const el = $("sync-feedback");
  if (!el) return;
  el.hidden = true;
  el.className = "feedback";
}

/** Waarschuwing na transcriptie (bijv. matige audiokwaliteit). */
export function showQualityWarning(msg) {
  if (!msg?.trim()) return;
  showFeedback(msg.trim(), "warning");
}

/** @param {string} msg @param {"success"|"error"|"warning"} type */
export function showInputFeedback(msg, type) {
  const el = $("input-feedback");
  if (!el) {
    showFeedback(msg, type);
    return;
  }
  el.textContent = msg;
  el.hidden = false;
  el.className = `feedback is-${type}`;
}

export function hideInputFeedback() {
  const el = $("input-feedback");
  if (!el) return;
  el.hidden = true;
  el.className = "feedback";
}

/** @param {{ taskResults?: { subject: string; success: boolean; id?: string; errors?: string[] }[]; eventResults?: { subject: string; success: boolean; id?: string; errors?: string[] }[]; noteId?: string; dryRun?: boolean }} sf */
export function formatSyncFeedback(sf) {
  if (!sf) return null;
  if (sf.dryRun) return { msg: "Preview-modus: er is niets geüpload.", type: "error" };

  const parts = [];
  if (sf.noteId) parts.push(`Notitie ${sf.noteId}`);

  const failedTasks = (sf.taskResults ?? []).filter((t) => !t.success);
  const failedEvents = (sf.eventResults ?? []).filter((e) => !e.success);
  const okTasks = (sf.taskResults ?? []).filter((t) => t.success).length;
  const okEvents = (sf.eventResults ?? []).filter((e) => e.success).length;

  if (okTasks) parts.push(`${okTasks} ta${okTasks === 1 ? "" : "ken"}`);
  if (okEvents) parts.push(`${okEvents} agenda-item${okEvents === 1 ? "" : "s"}`);

  const warnings = [];
  for (const t of failedTasks) {
    warnings.push(`Taak "${t.subject}" mislukt: ${(t.errors ?? ["onbekend"]).join(", ")}`);
  }
  for (const e of failedEvents) {
    warnings.push(`Event "${e.subject}" mislukt: ${(e.errors ?? ["onbekend"]).join(", ")}`);
  }

  if (!sf.noteId && !parts.length) {
    return { msg: "Upload mislukt.", type: "error" };
  }

  const base = parts.length ? `Geüpload: ${parts.join(", ")}.` : "Geüpload.";
  if (warnings.length) {
    return { msg: `${base} Waarschuwing: ${warnings.join(" ")}`, type: "error" };
  }
  return { msg: base, type: "success" };
}
