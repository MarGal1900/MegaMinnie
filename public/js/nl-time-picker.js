import { escapeHtml } from "./dom.js";

/** @param {number} h @param {number} m */
export function formatNlTime(h, m) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** @param {string} value */
export function parseNlTime(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** @param {string} iso */
export function timeValueFromIso(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return formatNlTime(d.getHours(), d.getMinutes());
  } catch {
    return "";
  }
}

/**
 * @param {string} className
 * @param {string} value
 */
export function buildNlTimeFieldHtml(className, value) {
  const parsed = parseNlTime(value);
  const display = parsed ? formatNlTime(parsed.h, parsed.m) : "--:--";
  const hiddenValue = parsed ? formatNlTime(parsed.h, parsed.m) : "";

  return `
    <div class="nl-time-field">
      <button type="button" class="nl-time-field__trigger" aria-haspopup="dialog" aria-label="Tijd kiezen">
        <span class="nl-time-field__icon" aria-hidden="true"></span>
        <span class="nl-time-field__value">${escapeHtml(display)}</span>
      </button>
      <input type="hidden" class="${escapeHtml(className)}" value="${escapeHtml(hiddenValue)}" />
    </div>`;
}

/** @param {HTMLElement} field @param {string} value */
function syncTimeField(field, value) {
  const parsed = parseNlTime(value);
  const hidden = field.querySelector('input[type="hidden"]');
  const display = field.querySelector(".nl-time-field__value");
  if (hidden) hidden.value = parsed ? formatNlTime(parsed.h, parsed.m) : "";
  if (display) display.textContent = parsed ? formatNlTime(parsed.h, parsed.m) : "--:--";
}

/** @type {HTMLElement | null} */
let pickerEl = null;
/** @type {HTMLElement | null} */
let activeField = null;
/** @type {(() => void) | null} */
let activeOnChange = null;
/** @type {{ h: number; m: number }} */
let draft = { h: 9, m: 0 };
/** @type {"hour" | "minute"} */
let mode = "hour";

/** @param {number} count @param {number} index */
function optionAngle(count, index) {
  return (index / count) * 360 - 90;
}

function renderPickerFace() {
  if (!pickerEl) return;
  const face = pickerEl.querySelector(".nl-time-picker__face");
  const modeLabel = pickerEl.querySelector(".nl-time-picker__mode");
  const display = pickerEl.querySelector(".nl-time-picker__display");
  const fineLabel = pickerEl.querySelector(".nl-time-picker__fine-label");
  if (!face || !modeLabel || !display) return;

  display.textContent = formatNlTime(draft.h, draft.m);
  modeLabel.textContent = mode === "hour" ? "Kies uur" : "Kies minuut";
  if (fineLabel) fineLabel.textContent = String(draft.m).padStart(2, "0");
  face.dataset.mode = mode;
  face.innerHTML = "";

  if (mode === "hour") {
    for (let h = 0; h < 24; h++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nl-time-picker__option";
      if (h === draft.h) btn.classList.add("is-selected");
      btn.textContent = String(h).padStart(2, "0");
      btn.style.setProperty("--angle", `${optionAngle(24, h)}deg`);
      btn.addEventListener("click", () => {
        draft.h = h;
        mode = "minute";
        renderPickerFace();
      });
      face.appendChild(btn);
    }
    return;
  }

  for (let i = 0; i < 12; i++) {
    const m = i * 5;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nl-time-picker__option";
    if (Math.floor(draft.m / 5) * 5 === m) btn.classList.add("is-selected");
    btn.textContent = String(m).padStart(2, "0");
    btn.style.setProperty("--angle", `${optionAngle(12, i)}deg`);
    btn.addEventListener("click", () => {
      draft.m = m;
      renderPickerFace();
    });
    face.appendChild(btn);
  }
}

function closePicker() {
  if (!pickerEl) return;
  pickerEl.hidden = true;
  activeField = null;
  activeOnChange = null;
}

function confirmPicker() {
  if (activeField) {
    syncTimeField(activeField, formatNlTime(draft.h, draft.m));
    activeOnChange?.();
  }
  closePicker();
}

function ensurePicker() {
  if (pickerEl) return pickerEl;

  pickerEl = document.createElement("div");
  pickerEl.className = "nl-time-picker";
  pickerEl.hidden = true;
  pickerEl.innerHTML = `
    <div class="nl-time-picker__backdrop" data-action="cancel"></div>
    <div class="nl-time-picker__sheet" role="dialog" aria-modal="true" aria-label="Tijd kiezen">
      <p class="nl-time-picker__mode">Kies uur</p>
      <p class="nl-time-picker__display">09:00</p>
      <div class="nl-time-picker__face" data-mode="hour"></div>
      <div class="nl-time-picker__fine">
        <button type="button" class="nl-time-picker__fine-btn" data-action="minute-minus" aria-label="Minuut terug">−</button>
        <span class="nl-time-picker__fine-label">00</span>
        <button type="button" class="nl-time-picker__fine-btn" data-action="minute-plus" aria-label="Minuut vooruit">+</button>
      </div>
      <div class="nl-time-picker__actions">
        <button type="button" class="btn btn--ghost" data-action="cancel">Annuleren</button>
        <button type="button" class="btn btn--primary" data-action="confirm">OK</button>
      </div>
    </div>`;

  pickerEl.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const actionEl = target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.getAttribute("data-action");
    if (action === "cancel") closePicker();
    if (action === "confirm") confirmPicker();
    if (action === "minute-minus") {
      draft.m = (draft.m + 59) % 60;
      renderPickerFace();
    }
    if (action === "minute-plus") {
      draft.m = (draft.m + 1) % 60;
      renderPickerFace();
    }
  });

  document.body.appendChild(pickerEl);
  return pickerEl;
}

/**
 * @param {HTMLElement} field
 * @param {(() => void) | undefined} onChange
 */
export function openNlTimePicker(field, onChange) {
  const hidden = field.querySelector('input[type="hidden"]');
  const parsed = parseNlTime(hidden?.value ?? "") ?? { h: 9, m: 0 };
  draft = { ...parsed };
  mode = "hour";
  activeField = field;
  activeOnChange = onChange ?? null;
  ensurePicker();
  renderPickerFace();
  pickerEl.hidden = false;
}

/**
 * @param {HTMLElement} container
 * @param {(() => void) | undefined} onChange
 */
export function attachNlTimePickerHandlers(container, onChange) {
  if (!container || container.dataset.nlTimePickerBound === "true") return;
  container.dataset.nlTimePickerBound = "true";

  container.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest(".nl-time-field__trigger");
    if (!trigger) return;
    const field = trigger.closest(".nl-time-field");
    if (!field || !container.contains(field)) return;
    e.preventDefault();
    openNlTimePicker(field, onChange);
  });
}
