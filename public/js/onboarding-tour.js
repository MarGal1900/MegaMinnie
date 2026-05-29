const ONBOARDING_STORAGE_KEY = "megaminnie_onboarding_complete";

/** @typedef {"top"|"bottom"|"left"|"right"|"center"} TourPlacement */

/**
 * @typedef {object} TourStep
 * @property {string} target
 * @property {string} title
 * @property {string} body
 * @property {TourPlacement} [placement]
 * @property {number} [padding]
 */

const TOUR_STEPS = [
  {
    target: "#flow-steps",
    title: "Welkom bij MegaMinnie",
    body: "MegaMinnie zet je bezoeknotities om in een gestructureerd Salesforce-verslag. Bovenaan zie je altijd waar je bent: invoer → uitwerken → controle → upload.",
    placement: "bottom",
    padding: 10,
  },
  {
    target: "#file-dropzone",
    title: "Invoer toevoegen",
    body: "Sleep hier foto's, audio, Word, PDF of tekst naartoe. Je kunt meerdere bestanden combineren, bijvoorbeeld foto's van een locatiebezoek.",
    placement: "bottom",
    padding: 8,
  },
  {
    target: ".input-hub__actions",
    title: "Kies je invoermethode",
    body: "<strong>Opname gesprek</strong> voor een vrij gesprek, <strong>Vraag &amp; Antwoord</strong> voor begeleide vragen, of <strong>Handmatige invoer</strong> om te typen of plakken.",
    placement: "bottom",
    padding: 8,
  },
  {
    target: "#btn-process",
    title: "Laat MegaMinnie uitwerken",
    body: "Als je invoer klaar is, klik je op <strong>Zet MegaMinnie aan het werk</strong>. MegaMinnie transcribeert, analyseert en maakt een conceptverslag.",
    placement: "top",
    padding: 8,
  },
  {
    target: '.workflow-timeline__step[data-step="3"]',
    title: "Controleer en verfijn",
    body: "Hierna verschijnt je conceptverslag. Je kunt het bewerken, laten voorlezen, mondeling corrigeren, taken en afspraken toevoegen, en een e-mail naar de klant opstellen.",
    placement: "bottom",
    padding: 10,
  },
  {
    target: '.workflow-timeline__step[data-step="4"]',
    title: "Upload naar Salesforce",
    body: "Zoek of kies een klantrecord, controleer het voorstel en upload notitie, taken en agenda-items naar Salesforce. De statusbadge rechtsboven toont preview- of live-modus.",
    placement: "bottom",
    padding: 10,
  },
];

/** @type {HTMLElement | null} */
let root = null;
/** @type {HTMLElement | null} */
let spotlight = null;
/** @type {HTMLElement | null} */
let popover = null;
/** @type {HTMLElement | null} */
let highlightedEl = null;
/** @type {number} */
let currentStep = 0;
/** @type {boolean} */
let active = false;
/** @type {(() => void) | null} */
let onCompleteCallback = null;

/**
 * @param {string} selector
 * @returns {HTMLElement | null}
 */
function queryTarget(selector) {
  try {
    const el = document.querySelector(selector);
    return el instanceof HTMLElement ? el : null;
  } catch {
    return null;
  }
}

export function isOnboardingComplete() {
  return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
}

function markOnboardingComplete() {
  localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
}

function clearHighlight() {
  if (highlightedEl) {
    highlightedEl.classList.remove("is-onboarding-target");
    highlightedEl = null;
  }
  if (spotlight) spotlight.hidden = true;
}

function teardown() {
  clearHighlight();
  if (root) {
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("is-onboarding-active");
  active = false;
  window.removeEventListener("resize", reposition);
  window.removeEventListener("scroll", reposition, true);
}

function finishTour(completed) {
  if (completed) markOnboardingComplete();
  teardown();
  onCompleteCallback?.();
}

/**
 * @param {number} index
 * @returns {TourStep | null}
 */
function getStep(index) {
  return TOUR_STEPS[index] ?? null;
}

/**
 * @param {HTMLElement} el
 * @param {TourPlacement} placement
 * @param {DOMRect} targetRect
 * @param {DOMRect} popRect
 */
function positionPopover(el, placement, targetRect, popRect) {
  const margin = 14;
  const viewportPad = 12;
  let top = 0;
  let left = 0;
  let resolved = placement;

  if (placement === "center" || !targetRect.width) {
    top = window.innerHeight / 2 - popRect.height / 2;
    left = window.innerWidth / 2 - popRect.width / 2;
    el.dataset.placement = "center";
    el.style.top = `${Math.max(viewportPad, top)}px`;
    el.style.left = `${Math.max(viewportPad, left)}px`;
    return;
  }

  const fits = {
    bottom: targetRect.bottom + margin + popRect.height <= window.innerHeight - viewportPad,
    top: targetRect.top - margin - popRect.height >= viewportPad,
    right: targetRect.right + margin + popRect.width <= window.innerWidth - viewportPad,
    left: targetRect.left - margin - popRect.width >= viewportPad,
  };

  if (!fits[resolved]) {
    if (fits.bottom) resolved = "bottom";
    else if (fits.top) resolved = "top";
    else if (fits.left) resolved = "left";
    else if (fits.right) resolved = "right";
    else resolved = "center";
  }

  if (resolved === "bottom") {
    top = targetRect.bottom + margin;
    left = targetRect.left + targetRect.width / 2 - popRect.width / 2;
  } else if (resolved === "top") {
    top = targetRect.top - margin - popRect.height;
    left = targetRect.left + targetRect.width / 2 - popRect.width / 2;
  } else if (resolved === "left") {
    top = targetRect.top + targetRect.height / 2 - popRect.height / 2;
    left = targetRect.left - margin - popRect.width;
  } else if (resolved === "right") {
    top = targetRect.top + targetRect.height / 2 - popRect.height / 2;
    left = targetRect.right + margin;
  } else {
    top = window.innerHeight / 2 - popRect.height / 2;
    left = window.innerWidth / 2 - popRect.width / 2;
  }

  left = Math.min(Math.max(viewportPad, left), window.innerWidth - popRect.width - viewportPad);
  top = Math.min(Math.max(viewportPad, top), window.innerHeight - popRect.height - viewportPad);

  el.dataset.placement = resolved;
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

function repositionSpotlight() {
  if (!spotlight || !highlightedEl || spotlight.hidden) return;

  const step = getStep(currentStep);
  const padding = step?.padding ?? 8;
  const rect = highlightedEl.getBoundingClientRect();

  spotlight.style.top = `${Math.max(8, rect.top - padding)}px`;
  spotlight.style.left = `${Math.max(8, rect.left - padding)}px`;
  spotlight.style.width = `${rect.width + padding * 2}px`;
  spotlight.style.height = `${rect.height + padding * 2}px`;
}

function repositionPopover() {
  if (!popover || !root || root.hidden) return;

  const step = getStep(currentStep);
  if (!step) return;

  const target = queryTarget(step.target);
  const placement = step.placement ?? "bottom";
  const targetRect =
    target && placement !== "center" ? target.getBoundingClientRect() : new DOMRect(0, 0, 0, 0);

  popover.style.visibility = "hidden";
  popover.style.top = "0";
  popover.style.left = "0";
  const popRect = popover.getBoundingClientRect();
  positionPopover(popover, placement, targetRect, popRect);
  popover.style.visibility = "";
}

function reposition() {
  repositionSpotlight();
  repositionPopover();
}

function renderStep() {
  const step = getStep(currentStep);
  if (!step || !root || !popover || !spotlight) return;

  clearHighlight();

  const target = queryTarget(step.target);
  const isLast = currentStep === TOUR_STEPS.length - 1;

  if (target && (step.placement ?? "bottom") !== "center") {
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    highlightedEl = target;
    highlightedEl.classList.add("is-onboarding-target");
    spotlight.hidden = false;
    window.requestAnimationFrame(() => {
      repositionSpotlight();
      repositionPopover();
    });
  } else {
    spotlight.hidden = true;
    window.requestAnimationFrame(repositionPopover);
  }

  const titleEl = popover.querySelector(".onboarding-tour__title");
  const bodyEl = popover.querySelector(".onboarding-tour__body");
  const stepEl = popover.querySelector(".onboarding-tour__step-label");
  const backBtn = popover.querySelector('[data-action="prev"]');
  const nextBtn = popover.querySelector('[data-action="next"]');
  const dots = popover.querySelectorAll(".onboarding-tour__dot");

  if (titleEl) titleEl.textContent = step.title;
  if (bodyEl) bodyEl.innerHTML = step.body;
  if (stepEl) stepEl.textContent = `Stap ${currentStep + 1} van ${TOUR_STEPS.length}`;
  if (backBtn instanceof HTMLButtonElement) backBtn.disabled = currentStep === 0;
  if (nextBtn instanceof HTMLButtonElement) {
    nextBtn.textContent = isLast ? "Aan de slag" : "Volgende";
  }

  dots.forEach((dot, index) => {
    dot.classList.toggle("is-active", index === currentStep);
    dot.classList.toggle("is-done", index < currentStep);
  });
}

function goToStep(index) {
  if (index < 0 || index >= TOUR_STEPS.length) return;
  currentStep = index;
  renderStep();
}

function handleKeydown(event) {
  if (!active) return;
  if (event.key === "Escape") {
    event.preventDefault();
    finishTour(false);
    return;
  }
  if (event.key === "ArrowRight" || event.key === "Enter") {
    event.preventDefault();
    if (currentStep < TOUR_STEPS.length - 1) goToStep(currentStep + 1);
    else finishTour(true);
    return;
  }
  if (event.key === "ArrowLeft" && currentStep > 0) {
    event.preventDefault();
    goToStep(currentStep - 1);
  }
}

function handleClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const actionEl = target.closest("[data-action]");
  if (!actionEl || !popover?.contains(actionEl)) return;

  const action = actionEl.getAttribute("data-action");
  if (action === "skip") {
    finishTour(true);
    return;
  }
  if (action === "prev") {
    goToStep(currentStep - 1);
    return;
  }
  if (action === "next") {
    if (currentStep < TOUR_STEPS.length - 1) goToStep(currentStep + 1);
    else finishTour(true);
  }
}

function ensureDom() {
  if (root) return;

  root = document.createElement("div");
  root.className = "onboarding-tour";
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");

  const backdrop = document.createElement("div");
  backdrop.className = "onboarding-tour__backdrop";
  backdrop.addEventListener("click", () => finishTour(false));

  spotlight = document.createElement("div");
  spotlight.className = "onboarding-tour__spotlight";
  spotlight.hidden = true;

  popover = document.createElement("div");
  popover.className = "onboarding-tour__popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-modal", "true");
  popover.setAttribute("aria-labelledby", "onboarding-tour-title");
  popover.innerHTML = `
    <div class="onboarding-tour__header">
      <p class="onboarding-tour__step-label">Stap 1 van ${TOUR_STEPS.length}</p>
      <button type="button" class="onboarding-tour__skip" data-action="skip">Overslaan</button>
    </div>
    <h2 id="onboarding-tour-title" class="onboarding-tour__title"></h2>
    <div class="onboarding-tour__body"></div>
    <div class="onboarding-tour__progress" aria-hidden="true">
      ${TOUR_STEPS.map((_, index) => `<span class="onboarding-tour__dot${index === 0 ? " is-active" : ""}"></span>`).join("")}
    </div>
    <div class="onboarding-tour__actions">
      <button type="button" class="btn btn--ghost onboarding-tour__btn-prev" data-action="prev">Vorige</button>
      <button type="button" class="btn btn--primary onboarding-tour__btn-next" data-action="next">Volgende</button>
    </div>
  `;

  root.append(backdrop, spotlight, popover);
  document.body.append(root);

  popover.addEventListener("click", handleClick);
  document.addEventListener("keydown", handleKeydown);
}

/**
 * @param {{ force?: boolean, onComplete?: () => void }} [options]
 */
export function startOnboardingTour(options = {}) {
  ensureDom();
  if (!root || !popover) return;

  onCompleteCallback = options.onComplete ?? null;
  currentStep = 0;
  active = true;

  root.hidden = false;
  root.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-onboarding-active");

  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);

  renderStep();
  popover.querySelector('[data-action="next"]')?.focus();
}

/**
 * @param {{ autoStart?: boolean, delayMs?: number, onComplete?: () => void }} [options]
 */
export function initOnboardingTour(options = {}) {
  const { autoStart = true, delayMs = 600, onComplete } = options;

  ensureDom();

  const helpBtn = document.getElementById("btn-tour-help");
  helpBtn?.addEventListener("click", () => {
    startOnboardingTour({ force: true, onComplete });
  });

  if (autoStart && !isOnboardingComplete()) {
    window.setTimeout(() => {
      startOnboardingTour({ onComplete });
    }, delayMs);
  }
}
