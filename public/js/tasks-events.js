import { $, escapeHtml, toDatetimeLocalValue, fromDatetimeLocalValue } from "./dom.js";

const TASK_PRIORITIES = ["High", "Normal", "Low"];
const TASK_STATUSES = ["Not Started", "In Progress", "Completed"];

/** @param {"tasks"|"events"} kind @param {Record<string, unknown>[]} items */
export function renderEditableList(kind, items) {
  const section = $(`${kind}-section`);
  const list = $(`${kind}-list`);
  if (!section || !list) return;

  list.innerHTML = "";
  if (!items?.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "card-list__item card-list__item--editable";

    if (kind === "tasks") {
      li.innerHTML = `
        <div class="card-list__fields">
          <label class="field field--compact">
            <span class="field__label">Onderwerp</span>
            <input type="text" class="task-subject" value="${escapeHtml(String(item.subject))}" />
          </label>
          <label class="field field--compact">
            <span class="field__label">Datum</span>
            <input type="date" class="task-date" value="${escapeHtml(String(item.activityDate))}" />
          </label>
          <label class="field field--compact">
            <span class="field__label">Prioriteit</span>
            <select class="task-priority">
              ${TASK_PRIORITIES.map((p) => `<option value="${p}"${p === item.priority ? " selected" : ""}>${p}</option>`).join("")}
            </select>
          </label>
          <label class="field field--compact">
            <span class="field__label">Status</span>
            <select class="task-status">
              ${TASK_STATUSES.map((s) => `<option value="${s}"${s === item.status ? " selected" : ""}>${s}</option>`).join("")}
            </select>
          </label>
          <label class="field field--compact field--full">
            <span class="field__label">Beschrijving</span>
            <textarea class="task-description" rows="2">${escapeHtml(String(item.description ?? ""))}</textarea>
          </label>
        </div>
        <button type="button" class="btn btn--ghost btn--tiny card-list__remove" aria-label="Taak verwijderen">Verwijderen</button>`;
    } else {
      li.innerHTML = `
        <div class="card-list__fields">
          <label class="field field--compact">
            <span class="field__label">Onderwerp</span>
            <input type="text" class="event-subject" value="${escapeHtml(String(item.subject))}" />
          </label>
          <label class="field field--compact">
            <span class="field__label">Start</span>
            <input type="datetime-local" class="event-start" value="${escapeHtml(toDatetimeLocalValue(String(item.startDateTime)))}" />
          </label>
          <label class="field field--compact">
            <span class="field__label">Einde</span>
            <input type="datetime-local" class="event-end" value="${escapeHtml(toDatetimeLocalValue(String(item.endDateTime)))}" />
          </label>
          <label class="field field--compact">
            <span class="field__label">Locatie</span>
            <input type="text" class="event-location" value="${escapeHtml(String(item.location ?? ""))}" />
          </label>
          <label class="field field--compact field--full">
            <span class="field__label">Beschrijving</span>
            <textarea class="event-description" rows="2">${escapeHtml(String(item.description ?? ""))}</textarea>
          </label>
        </div>
        <button type="button" class="btn btn--ghost btn--tiny card-list__remove" aria-label="Agenda-item verwijderen">Verwijderen</button>`;
    }

    li.querySelector(".card-list__remove")?.addEventListener("click", () => {
      li.remove();
      if (!list.querySelector(".card-list__item")) section.hidden = true;
    });

    list.appendChild(li);
  }
}

/** @param {Record<string, unknown>} megaMinnie */
export function collectTasksEventsFromUi(megaMinnie) {
  const tasks = [];
  const events = [];

  document.querySelectorAll("#tasks-list .card-list__item").forEach((li) => {
    const subject = li.querySelector(".task-subject")?.value.trim() ?? "";
    const activityDate = li.querySelector(".task-date")?.value ?? "";
    if (!subject || !activityDate) return;
    tasks.push({
      subject,
      activityDate,
      priority: li.querySelector(".task-priority")?.value ?? "Normal",
      status: li.querySelector(".task-status")?.value ?? "Not Started",
      description: li.querySelector(".task-description")?.value.trim() || undefined,
    });
  });

  document.querySelectorAll("#events-list .card-list__item").forEach((li) => {
    const subject = li.querySelector(".event-subject")?.value.trim() ?? "";
    const startRaw = li.querySelector(".event-start")?.value ?? "";
    const endRaw = li.querySelector(".event-end")?.value ?? "";
    if (!subject || !startRaw || !endRaw) return;
    events.push({
      subject,
      startDateTime: fromDatetimeLocalValue(startRaw),
      endDateTime: fromDatetimeLocalValue(endRaw),
      location: li.querySelector(".event-location")?.value.trim() || undefined,
      description: li.querySelector(".event-description")?.value.trim() || undefined,
    });
  });

  return { ...megaMinnie, tasks, events };
}

/** @param {{ megaMinnie: { tasks: Record<string, unknown>[]; events: Record<string, unknown>[] } }} result */
export function renderTasksAndEvents(result) {
  renderEditableList("tasks", result.megaMinnie.tasks);
  renderEditableList("events", result.megaMinnie.events);
}
