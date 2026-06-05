/**
 * First-time-use onboarding tour.
 * Shows a spotlight + tooltip overlay the first time a user opens the app.
 * Once dismissed or completed, `localStorage` flag `mm_onboarding_done` is set
 * and the tour never reappears.
 */

const STORAGE_KEY = "mm_onboarding_done";
const SPOTLIGHT_PAD = 8; // px clearance around target element
const TOOLTIP_MARGIN = 14; // px gap between spotlight edge and tooltip
const TOOLTIP_SCREEN_PAD = 16; // min px distance from viewport edge

/** @type {Array<{targetId?: string, title: string, body: string}>} */
const STEPS = [
  {
    title: "Hi, ik ben MegaMinnie!",
    body: "Ik ga jou veel werk uit handen nemen. Oude tijden herleven, maar nu in een digitale wereld. Laat me je even rondleiden.",
  },
  {
    targetId: "flow-steps",
    title: "Zo werkt het",
    body: "Vier stappen: voeg je invoer toe, laat MegaMinnie het uitwerken, controleer het resultaat en upload alles naar Salesforce.",
  },
  {
    targetId: "file-dropzone",
    title: "Bestanden toevoegen",
    body: "Sleep foto's, audio-opnames, Word-documenten of PDF's hier naartoe — of klik om te kiezen. Je kunt meerdere foto's tegelijk uploaden.",
  },
  {
    targetId: "btn-conversation",
    title: "Opname gesprek",
    body: "Neem een gesprek vrij op met je microfoon. MegaMinnie transcribeert automatisch en verwerkt het tot een volledig bezoekverslag.",
  },
  {
    targetId: "btn-invoer",
    title: "Vraag &amp; Antwoord",
    body: "Start een AI-interview: MegaMinnie stelt zes gerichte vragen en jij antwoordt hardop. Ideaal als je nog geen aantekeningen hebt. Achteraf kun je de notitie mondeling corrigeren.",
  },
  {
    targetId: "btn-manual",
    title: "Handmatige invoer",
    body: "Typ of plak je bezoeknotities direct in een tekstveld. Handig als je aantekeningen al klaar hebt.",
  },
  {
    targetId: "btn-process",
    title: "MegaMinnie aan het werk",
    body: "Als je invoer klaar is, klik je hier. MegaMinnie analyseert alles en maakt automatisch een verslag, taken en agenda afspraken aan.",
  },
];

export class OnboardingTour {
  /** @type {number} */ #step = 0;
  /** @type {HTMLElement|null} */ #overlay = null;
  /** @type {HTMLElement|null} */ #spotlight = null;
  /** @type {HTMLElement|null} */ #tooltip = null;
  /** @type {ResizeObserver|null} */ #resizeObserver = null;

  get isDone() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return true;
    }
  }

  #markDone() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // localStorage not available — ignore
    }
  }

  /** Reset the tour so it shows again on next page load (useful for testing). */
  reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  /** Reset and immediately restart the tour. Useful for a "replay" button. */
  restart() {
    this.reset();
    this.#step = 0;
    if (!this.#overlay) {
      this.#buildDom();
    }
    this.#render();
  }

  /** Start the tour if it has not been completed yet. No-op if already done. */
  start() {
    if (this.isDone) return;
    this.#step = 0;
    this.#buildDom();
    this.#render();
  }

  #buildDom() {
    this.#overlay = document.createElement("div");
    this.#overlay.className = "onboarding-overlay";
    this.#overlay.setAttribute("role", "dialog");
    this.#overlay.setAttribute("aria-modal", "true");
    this.#overlay.setAttribute("aria-label", "Welkom bij MegaMinnie — rondleiding");

    this.#spotlight = document.createElement("div");
    this.#spotlight.className = "onboarding-spotlight";
    this.#spotlight.setAttribute("aria-hidden", "true");

    this.#tooltip = document.createElement("div");
    this.#tooltip.className = "onboarding-tooltip";

    this.#overlay.append(this.#spotlight, this.#tooltip);
    document.body.appendChild(this.#overlay);

    this.#overlay.addEventListener("click", (e) => {
      if (e.target === this.#overlay) this.#close();
    });

    document.addEventListener("keydown", this.#onKeyDown);

    this.#resizeObserver = new ResizeObserver(() => this.#render());
    this.#resizeObserver.observe(document.body);
  }

  /** @param {KeyboardEvent} e */
  #onKeyDown = (e) => {
    if (e.key === "Escape") {
      this.#close();
    } else if (e.key === "ArrowRight") {
      this.#advance();
    } else if (e.key === "ArrowLeft") {
      this.#retreat();
    }
  };

  #render() {
    if (!this.#overlay) return;
    const step = STEPS[this.#step];
    const target = step.targetId ? document.getElementById(step.targetId) : null;
    const rect = target ? target.getBoundingClientRect() : null;

    this.#renderSpotlight(rect);
    this.#renderTooltip(step, rect);
  }

  /** @param {DOMRect|null} rect */
  #renderSpotlight(rect) {
    const sp = this.#spotlight;
    if (!sp) return;
    if (rect) {
      sp.style.top = `${rect.top - SPOTLIGHT_PAD}px`;
      sp.style.left = `${rect.left - SPOTLIGHT_PAD}px`;
      sp.style.width = `${rect.width + SPOTLIGHT_PAD * 2}px`;
      sp.style.height = `${rect.height + SPOTLIGHT_PAD * 2}px`;
      sp.removeAttribute("hidden");
    } else {
      sp.setAttribute("hidden", "");
    }
  }

  /**
   * @param {{targetId?: string, title: string, body: string}} step
   * @param {DOMRect|null} rect
   */
  #renderTooltip(step, rect) {
    const tt = this.#tooltip;
    if (!tt) return;

    const counter = `${this.#step + 1} van ${STEPS.length}`;
    const isFirst = this.#step === 0;
    const isLast = this.#step === STEPS.length - 1;

    tt.innerHTML = `
      <p class="onboarding-tooltip__counter" aria-live="polite">${counter}</p>
      <h2 class="onboarding-tooltip__title">${step.title}</h2>
      <p class="onboarding-tooltip__body">${step.body}</p>
      <div class="onboarding-tooltip__footer">
        <button type="button" class="onboarding-tooltip__skip btn btn--ghost btn--tiny">Overslaan</button>
        <div class="onboarding-tooltip__nav">
          ${isFirst ? "" : `<button type="button" class="onboarding-tooltip__prev btn btn--ghost">Vorige</button>`}
          <button type="button" class="onboarding-tooltip__next btn btn--primary">
            ${isLast ? "Beginnen" : "Volgende"}
          </button>
        </div>
      </div>
    `.trim();

    tt.querySelector(".onboarding-tooltip__skip")?.addEventListener("click", () => this.#close());
    tt.querySelector(".onboarding-tooltip__next")?.addEventListener("click", () => this.#advance());
    tt.querySelector(".onboarding-tooltip__prev")?.addEventListener("click", () => this.#retreat());

    this.#positionTooltip(rect);
  }

  /** @param {DOMRect|null} rect */
  #positionTooltip(rect) {
    const tt = this.#tooltip;
    if (!tt) return;

    if (!rect) {
      tt.style.top = "50%";
      tt.style.left = "50%";
      tt.style.transform = "translate(-50%, -50%)";
      return;
    }

    tt.style.transform = "";
    // Measure after content is set
    const ttH = tt.offsetHeight || 200;
    const ttW = tt.offsetWidth || 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spaceBelow = vh - rect.bottom - TOOLTIP_SCREEN_PAD;
    const spaceAbove = rect.top - TOOLTIP_SCREEN_PAD;

    let top;
    if (spaceBelow >= ttH + TOOLTIP_MARGIN || spaceBelow >= spaceAbove) {
      top = rect.bottom + TOOLTIP_MARGIN;
    } else {
      top = rect.top - TOOLTIP_MARGIN - ttH;
    }

    let left = rect.left + rect.width / 2 - ttW / 2;
    left = Math.max(TOOLTIP_SCREEN_PAD, Math.min(left, vw - ttW - TOOLTIP_SCREEN_PAD));
    top = Math.max(TOOLTIP_SCREEN_PAD, Math.min(top, vh - ttH - TOOLTIP_SCREEN_PAD));

    tt.style.top = `${top}px`;
    tt.style.left = `${left}px`;
  }

  #advance() {
    if (this.#step < STEPS.length - 1) {
      this.#step++;
      this.#render();
    } else {
      this.#close();
    }
  }

  #retreat() {
    if (this.#step > 0) {
      this.#step--;
      this.#render();
    }
  }

  #close() {
    this.#markDone();
    document.removeEventListener("keydown", this.#onKeyDown);
    this.#resizeObserver?.disconnect();
    this.#overlay?.remove();
    this.#overlay = null;
    this.#spotlight = null;
    this.#tooltip = null;
  }
}

/**
 * Convenience helper: creates and starts an `OnboardingTour` if not yet done.
 * Call this once after the app has fully initialised.
 *
 * @returns {OnboardingTour} The tour instance (allows calling `.reset()` from devtools).
 */
export function startOnboardingIfNeeded() {
  const tour = new OnboardingTour();
  tour.start();
  return tour;
}

/** Expose step definitions for testing without instantiating a tour. */
export { STEPS, STORAGE_KEY };
