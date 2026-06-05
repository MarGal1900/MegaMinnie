import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { OnboardingTour, startOnboardingIfNeeded, STEPS, STORAGE_KEY } from "../public/js/onboarding.js";
// Note: startOnboardingIfNeeded remains exported for external consumers

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------
function makeLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { store.set(k, v); }),
    removeItem: vi.fn((k: string) => { store.delete(k); }),
    clear: vi.fn(() => { store.clear(); }),
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// Stap-definitie sanity checks (geen DOM nodig)
// ---------------------------------------------------------------------------
describe("STEPS definitie", () => {
  it("bevat 7 stappen", () => {
    expect(STEPS).toHaveLength(7);
  });

  it("elke stap heeft een title en body; stappen met targetId hebben een niet-lege string", () => {
    for (const step of STEPS) {
      expect(typeof step.title).toBe("string");
      expect(step.title.length).toBeGreaterThan(0);
      expect(typeof step.body).toBe("string");
      expect(step.body.length).toBeGreaterThan(0);
      if (step.targetId !== undefined) {
        expect(typeof step.targetId).toBe("string");
        expect(step.targetId.length).toBeGreaterThan(0);
      }
    }
  });

  it("stappen met targetId hebben unieke IDs", () => {
    const ids = STEPS.filter((s) => s.targetId !== undefined).map((s) => s.targetId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("verwachte targetIds zijn aanwezig", () => {
    const ids = STEPS.map((s) => s.targetId);
    expect(ids).toContain("flow-steps");
    expect(ids).toContain("file-dropzone");
    expect(ids).toContain("btn-conversation");
    expect(ids).toContain("btn-invoer");
    expect(ids).toContain("btn-manual");
    expect(ids).toContain("btn-process");
    expect(ids).not.toContain("btn-test-mode");
  });

  it("eerste stap is de introductie zonder targetId", () => {
    expect(STEPS[0].targetId).toBeUndefined();
    expect(STEPS[0].title).toContain("MegaMinnie");
  });

  it("tweede stap is de voortgangsindicator", () => {
    expect(STEPS[1].targetId).toBe("flow-steps");
  });

  it("Vraag & Antwoord stap vermeldt mondeling corrigeren", () => {
    const step = STEPS.find((s) => s.targetId === "btn-invoer");
    expect(step).toBeDefined();
    expect(step!.body).toContain("mondeling corrigeren");
  });
});

// ---------------------------------------------------------------------------
// STORAGE_KEY
// ---------------------------------------------------------------------------
describe("STORAGE_KEY", () => {
  it("is de verwachte string", () => {
    expect(STORAGE_KEY).toBe("mm_onboarding_done");
  });
});

// ---------------------------------------------------------------------------
// OnboardingTour.isDone — localStorage-logica
// ---------------------------------------------------------------------------
describe("OnboardingTour.isDone", () => {
  let lsMock: ReturnType<typeof makeLocalStorageMock>;

  beforeEach(() => {
    lsMock = makeLocalStorageMock();
    vi.stubGlobal("localStorage", lsMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is false als localStorage leeg is", () => {
    const tour = new OnboardingTour();
    expect(tour.isDone).toBe(false);
  });

  it('is true als localStorage "1" bevat', () => {
    lsMock._store.set(STORAGE_KEY, "1");
    const tour = new OnboardingTour();
    expect(tour.isDone).toBe(true);
  });

  it('is false bij een andere waarde dan "1"', () => {
    lsMock._store.set(STORAGE_KEY, "true");
    const tour = new OnboardingTour();
    expect(tour.isDone).toBe(false);
  });

  it("vangt localStorage-fouten af en geeft true terug", () => {
    lsMock.getItem.mockImplementation(() => { throw new Error("geblokkeerd"); });
    const tour = new OnboardingTour();
    expect(tour.isDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OnboardingTour.reset()
// ---------------------------------------------------------------------------
describe("OnboardingTour.reset()", () => {
  let lsMock: ReturnType<typeof makeLocalStorageMock>;

  beforeEach(() => {
    lsMock = makeLocalStorageMock();
    vi.stubGlobal("localStorage", lsMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("verwijdert de flag uit localStorage", () => {
    lsMock._store.set(STORAGE_KEY, "1");
    const tour = new OnboardingTour();
    expect(tour.isDone).toBe(true);
    tour.reset();
    expect(lsMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(tour.isDone).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OnboardingTour.restart() — reset + herstart zonder DOM als al klaar
// ---------------------------------------------------------------------------
describe("OnboardingTour.restart()", () => {
  let lsMock: ReturnType<typeof makeLocalStorageMock>;

  beforeEach(() => {
    lsMock = makeLocalStorageMock();
    vi.stubGlobal("localStorage", lsMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reset de localStorage-flag zodat isDone daarna false is", () => {
    lsMock._store.set(STORAGE_KEY, "1");
    const tour = new OnboardingTour();
    expect(tour.isDone).toBe(true);

    // Stub document en ResizeObserver zodat DOM-aanroepen geen fout geven
    const fakeEl = () => ({
      className: "",
      setAttribute: vi.fn(),
      append: vi.fn(),
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
      style: {},
      innerHTML: "",
      querySelector: vi.fn(() => null),
      offsetHeight: 0,
      offsetWidth: 0,
    });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => fakeEl()),
      body: { appendChild: vi.fn(), append: vi.fn() },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("ResizeObserver", vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })));

    tour.restart();

    expect(lsMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(tour.isDone).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OnboardingTour.start() — geen DOM-aanroep als tour al klaar is
// ---------------------------------------------------------------------------
describe("OnboardingTour.start()", () => {
  let lsMock: ReturnType<typeof makeLocalStorageMock>;

  beforeEach(() => {
    lsMock = makeLocalStorageMock();
    vi.stubGlobal("localStorage", lsMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("raakt document niet aan als isDone true is", () => {
    lsMock._store.set(STORAGE_KEY, "1");
    const createElementSpy = vi.fn();
    vi.stubGlobal("document", { createElement: createElementSpy });

    const tour = new OnboardingTour();
    tour.start();

    expect(createElementSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// startOnboardingIfNeeded — geeft OnboardingTour-instantie terug
// ---------------------------------------------------------------------------
describe("startOnboardingIfNeeded()", () => {
  let lsMock: ReturnType<typeof makeLocalStorageMock>;

  beforeEach(() => {
    lsMock = makeLocalStorageMock();
    vi.stubGlobal("localStorage", lsMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("geeft een OnboardingTour-instantie terug", () => {
    lsMock._store.set(STORAGE_KEY, "1");
    const tour = startOnboardingIfNeeded();
    expect(tour).toBeInstanceOf(OnboardingTour);
  });

  it("geeft geen fout als tour al klaar is", () => {
    lsMock._store.set(STORAGE_KEY, "1");
    expect(() => startOnboardingIfNeeded()).not.toThrow();
  });
});
