import { describe, expect, it } from "vitest";
import {
  escapeSoql,
  likePattern,
  normalizeTerm,
  scoreNameMatch,
} from "../src/lib/soql.js";

describe("escapeSoql", () => {
  it("escaped enkele quotes", () => {
    expect(escapeSoql("O'Brien")).toBe("O\\'Brien");
  });

  it("escaped backslashes", () => {
    expect(escapeSoql("a\\b")).toBe("a\\\\b");
  });
});

describe("normalizeTerm", () => {
  it("trimt en normaliseert whitespace", () => {
    expect(normalizeTerm("  foo   bar  ")).toBe("foo bar");
  });
});

describe("likePattern", () => {
  it("wrapt term in wildcards", () => {
    expect(likePattern("Acme")).toBe("%Acme%");
  });

  it("escaped quotes in pattern", () => {
    expect(likePattern("O'Brien")).toBe("%O\\'Brien%");
  });
});

describe("scoreNameMatch", () => {
  it("exacte match scoort 1", () => {
    expect(scoreNameMatch("Acme", "Acme")).toBe(1);
  });

  it("lege query scoort 0", () => {
    expect(scoreNameMatch("", "Acme")).toBe(0);
  });

  it("deeltelijke match scoort tussen 0 en 1", () => {
    const score = scoreNameMatch("Acme", "Acme Corporation");
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });
});
