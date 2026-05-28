import {
  $,
  escapeHtml,
  toDateInputValue,
  isoDatePartFromDateTime,
  combineIsoDateAndTime,
} from "./dom.js";
import {
  buildNlTimeFieldHtml,
  timeValueFromIso,
  attachNlTimePickerHandlers,
} from "./nl-time-picker.js";

const TASK_PRIORITIES = ["High", "Normal", "Low"];
const TASK_STATUSES = ["Not Started", "In Progress", "Completed"];

/** @typedef {{ getDefaultAssignee?: () => string; onItemsChanged?: (megaMinnie: Record<string, unknown>) => void }} TasksEventsControlOptions */

function buildCommitButton(action, label = "Aanmaken") {
  return `<button type="button" class="btn btn--primary btn--tiny card-list__commit" data-action="${action}">${label}</button>`;
}

/**
 * @param {Record<string, unknown>} item
 * @param {boolean} committed
 * @param {string} defaultAssignee
 */
function buildTaskCardHtml(item, committed, defaultAssignee) {
  const assignee = String(item.assignee ?? defaultAssignee);
  const commitBtn = committed ? "" : buildCommitButton("commit-task");
  const activityDate = toDateInputValue(String(item.activityDate ?? ""));

  return `
    <div class="card-list__head">
      <span class="card-list__kind card-list__kind--task">Taak</span>
      <div class="card-list__head-actions">
        ${commitBtn}
        <button type="button" class="btn btn--ghost btn--tiny card-list__remove" data-action="remove" aria-label="Taak verwijderen">Verwijderen</button>
      </div>
    </div>
    <div class="card-list__fields">
      <label class="field field--compact">
        <span class="field__label">Onderwerp</span>
        <input type="text" class="task-subject" value="${escapeHtml(String(item.subject ?? ""))}" />
      </label>
      <label class="field field--compact">
        <span class="field__label">Verantwoordelijke</span>
        <input type="text" class="task-assignee" value="${escapeHtml(assignee)}" />
      </label>
      <label class="field field--compact">
        <span class="field__label">Datum</span>
        <input type="date" class="task-date" lang="nl" value="${escapeHtml(activityDate)}" />
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
    </div>`;
}

function buildEventCardHtml(item, committed) {
  const commitBtn = committed ? "" : buildCommitButton("commit-event");
  const startDate = isoDatePartFromDateTime(String(item.startDateTime ?? ""));
  const startTime = timeValueFromIso(String(item.startDateTime ?? ""));
  const endDate = isoDatePartFromDateTime(String(item.endDateTime ?? ""));
  const endTime = timeValueFromIso(String(item.endDateTime ?? ""));

  return `
    <div class="card-list__head">
      <span class="card-list__kind card-list__kind--event">Agenda</span>
      <div class="card-list__head-actions">
        ${commitBtn}
        <button type="button" class="btn btn--ghost btn--tiny card-list__remove" data-action="remove" aria-label="Agenda-item verwijderen">Verwijderen</button>
      </div>
    </div>
    <div class="card-list__fields">
      <label class="field field--compact field--full">
        <span class="field__label">Onderwerp</span>
        <input type="text" class="event-subject" value="${escapeHtml(String(item.subject ?? ""))}" />
      </label>
      <div class="card-list__row">
        <label class="field field--compact">
          <span class="field__label">Startdatum</span>
          <input type="date" class="event-start-date" lang="nl" value="${escapeHtml(startDate)}" />
        </label>
        <label class="field field--compact">
          <span class="field__label">Starttijd</span>
          ${buildNlTimeFieldHtml("event-start-time", startTime)}
        </label>
      </div>
      <div class="card-list__row">
        <label class="field field--compact">
          <span class="field__label">Einddatum</span>
          <input type="date" class="event-end-date" lang="nl" value="${escapeHtml(endDate)}" />
        </label>
        <label class="field field--compact">
          <span class="field__label">Eindtijd</span>
          ${buildNlTimeFieldHtml("event-end-time", endTime)}
        </label>
      </div>
      <label class="field field--compact field--full">
        <span class="field__label">Locatie</span>
        <input type="text" class="event-location" value="${escapeHtml(String(item.location ?? ""))}" />
      </label>
      <label class="field field--compact field--full">
        <span class="field__label">Beschrijving</span>
        <textarea class="event-description" rows="2">${escapeHtml(String(item.description ?? ""))}</textarea>
      </label>
    </div>`;
}

/**
 * @param {"tasks"|"events"} kind
 * @param {Record<string, unknown>[]} items
 * @param {string} defaultAssignee
 */
function renderEditableList(kind, items, defaultAssignee) {
  const list = $(`${kind}-list`);
  if (!list) return;

  list.innerHTML = "";

  for (const item of items ?? []) {
    appendListItem(list, kind, item, true, defaultAssignee);
  }
}

/**
 * @param {HTMLElement} list
 * @param {"tasks"|"events"} kind
 * @param {Record<string, unknown>} item
 * @param {boolean} committed
 * @param {string} defaultAssignee
 */
function appendListItem(list, kind, item, committed, defaultAssignee) {
  const li = document.createElement("li");
  li.className =
    kind === "tasks"
      ? "card-list__item card-list__item--editable card-list__item--task" +
        (committed ? "" : " card-list__item--draft")
      : "card-list__item card-list__item--editable card-list__item--event" +
        (committed ? "" : " card-list__item--draft");
  li.dataset.committed = committed ? "true" : "false";
  li.innerHTML =
    kind === "tasks"
      ? buildTaskCardHtml(item, committed, defaultAssignee)
      : buildEventCardHtml(item, committed);
  list.appendChild(li);

  if (!committed) {
    li.querySelector(".task-subject, .event-subject")?.focus();
  }

  return li;
}

/** @param {HTMLElement} card */
function readTaskFromCard(card, defaultAssignee) {
  const activityDate = card.querySelector(".task-date")?.value ?? "";
  return {
    subject: card.querySelector(".task-subject")?.value.trim() ?? "",
    assignee: card.querySelector(".task-assignee")?.value.trim() || defaultAssignee,
    activityDate,
    priority: card.querySelector(".task-priority")?.value ?? "Normal",
    status: card.querySelector(".task-status")?.value ?? "Not Started",
    description: card.querySelector(".task-description")?.value.trim() || undefined,
    committed: card.dataset.committed === "true",
  };
}

/** @param {HTMLElement} card */
function readEventFromCard(card) {
  const startDate = card.querySelector(".event-start-date")?.value ?? "";
  const startTime = card.querySelector(".event-start-time")?.value ?? "";
  const endDate = card.querySelector(".event-end-date")?.value ?? "";
  const endTime = card.querySelector(".event-end-time")?.value ?? "";

  return {
    subject: card.querySelector(".event-subject")?.value.trim() ?? "",
    startDateTime: combineIsoDateAndTime(startDate, startTime),
    endDateTime: combineIsoDateAndTime(endDate, endTime),
    startDateInput: startDate.trim(),
    startTimeInput: startTime.trim(),
    endDateInput: endDate.trim(),
    endTimeInput: endTime.trim(),
    location: card.querySelector(".event-location")?.value.trim() || undefined,
    description: card.querySelector(".event-description")?.value.trim() || undefined,
    committed: card.dataset.committed === "true",
  };
}

/** @param {Record<string, unknown>} task */
function validateTask(task) {
  if (!task.subject) return "Vul een onderwerp in voor de taak.";
  if (!task.activityDate) return "Vul een datum in voor de taak.";
  return "";
}

/** @param {Record<string, unknown>} event */
function validateEvent(event) {
  if (!event.subject) return "Vul een onderwerp in voor het agenda-item.";
  if (!event.startDateInput || !event.startTimeInput) {
    return "Vul startdatum en starttijd in.";
  }
  if (!event.startDateTime) {
    return "Vul een geldige startdatum en starttijd in.";
  }
  if (!event.endDateInput || !event.endTimeInput) {
    return "Vul einddatum en eindtijd in.";
  }
  if (!event.endDateTime) {
    return "Vul een geldige einddatum en eindtijd in.";
  }
  return "";
}

/**
 * @param {Record<string, unknown>} megaMinnie
 * @param {string} [defaultAssignee="Accountmanager"]
 */
export function collectTasksEventsFromUi(megaMinnie, defaultAssignee = "Accountmanager") {
  /** @type {Record<string, unknown>[]} */
  const tasks = [];
  /** @type {Record<string, unknown>[]} */
  const events = [];

  document.querySelectorAll("#tasks-list .card-list__item").forEach((li) => {
    const task = readTaskFromCard(li, defaultAssignee);
    if (!task.committed) return;
    const err = validateTask(task);
    if (err) return;
    tasks.push({
      subject: task.subject,
      activityDate: task.activityDate,
      priority: task.priority,
      status: task.status,
      description: task.description,
      assignee: task.assignee,
    });
  });

  document.querySelectorAll("#events-list .card-list__item").forEach((li) => {
    const event = readEventFromCard(li);
    if (!event.committed) return;
    const err = validateEvent(event);
    if (err) return;
    events.push({
      subject: event.subject,
      startDateTime: event.startDateTime,
      endDateTime: event.endDateTime,
      location: event.location,
      description: event.description,
    });
  });

  return { ...megaMinnie, tasks, events };
}

/** @param {string} listId */
function hasListItems(listId) {
  const list = $(listId);
  return Boolean(list?.querySelector(".card-list__item"));
}

let tasksEventsOutputVisible = false;

function updateTasksEventsSectionsVisibility() {
  const tasksSection = $("tasks-section");
  const eventsSection = $("events-section");
  const actions = $("tasks-events-actions");

  if (!tasksEventsOutputVisible) {
    if (tasksSection) tasksSection.hidden = true;
    if (eventsSection) eventsSection.hidden = true;
    if (actions) actions.hidden = true;
    return;
  }

  if (actions) actions.hidden = false;
  if (tasksSection) tasksSection.hidden = !hasListItems("tasks-list");
  if (eventsSection) eventsSection.hidden = !hasListItems("events-list");
}

/**
 * @param {{ megaMinnie: { tasks: Record<string, unknown>[]; events: Record<string, unknown>[] } }} result
 * @param {string} [defaultAssignee="Accountmanager"]
 */
export function renderTasksAndEvents(result, defaultAssignee = "Accountmanager") {
  renderEditableList("tasks", result.megaMinnie.tasks, defaultAssignee);
  renderEditableList("events", result.megaMinnie.events, defaultAssignee);
  updateTasksEventsSectionsVisibility();
}

/** @param {boolean} show */
export function setTasksEventsToolbarVisible(show) {
  tasksEventsOutputVisible = show;
  updateTasksEventsSectionsVisibility();
}

/** @param {TasksEventsControlOptions} [options] */
export function initTasksEventsControls(options = {}) {
  const getDefaultAssignee = () =>
    typeof options.getDefaultAssignee === "function"
      ? options.getDefaultAssignee()
      : "Accountmanager";

  const persist = () => {
    options.onItemsChanged?.();
  };

  /** @param {HTMLElement} card */
  const commitTask = (card) => {
    const task = readTaskFromCard(card, getDefaultAssignee());
    const err = validateTask(task);
    if (err) {
      alert(err);
      return;
    }
    card.dataset.committed = "true";
    card.classList.remove("card-list__item--draft");
    card.querySelector(".card-list__commit")?.remove();
    persist();
  };

  /** @param {HTMLElement} card */
  const commitEvent = (card) => {
    const event = readEventFromCard(card);
    const err = validateEvent(event);
    if (err) {
      alert(err);
      return;
    }
    card.dataset.committed = "true";
    card.classList.remove("card-list__item--draft");
    card.querySelector(".card-list__commit")?.remove();
    persist();
  };

  /** @param {MouseEvent} e */
  const handleListClick = (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest("[data-action]");
    if (!btn) return;
    const card = btn.closest(".card-list__item");
    if (!card) return;

    const action = btn.getAttribute("data-action");
    if (action === "remove") {
      card.remove();
      updateTasksEventsSectionsVisibility();
      persist();
      return;
    }
    if (action === "commit-task") commitTask(card);
    if (action === "commit-event") commitEvent(card);
  };

  /** @param {Event} e */
  const handleListChange = (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const card = target.closest(".card-list__item");
    if (!card || card.dataset.committed !== "true") return;
    persist();
  };

  $("btn-add-task")?.addEventListener("click", () => {
    const list = $("tasks-list");
    if (!list) return;
    const today = new Date().toISOString().slice(0, 10);
    appendListItem(
      list,
      "tasks",
      {
        subject: "",
        assignee: getDefaultAssignee(),
        activityDate: today,
        priority: "Normal",
        status: "Not Started",
        description: "",
      },
      false,
      getDefaultAssignee(),
    );
    updateTasksEventsSectionsVisibility();
  });

  $("btn-add-event")?.addEventListener("click", () => {
    const list = $("events-list");
    if (!list) return;
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    appendListItem(
      list,
      "events",
      {
        subject: "",
        startDateTime: now.toISOString(),
        endDateTime: end.toISOString(),
        location: "",
        description: "",
      },
      false,
      getDefaultAssignee(),
    );
    updateTasksEventsSectionsVisibility();
  });

  $("tasks-list")?.addEventListener("click", handleListClick);
  $("events-list")?.addEventListener("click", handleListClick);
  $("tasks-list")?.addEventListener("change", handleListChange);
  $("events-list")?.addEventListener("change", handleListChange);

  attachNlTimePickerHandlers($("events-list"), persist);
}
