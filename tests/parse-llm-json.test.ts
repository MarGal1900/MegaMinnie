import { describe, expect, it } from "vitest";
import { parseJsonFromLlmResponse } from "../src/lib/parse-llm-json.js";

describe("parseJsonFromLlmResponse", () => {
  it("parseert plain JSON", () => {
    const result = parseJsonFromLlmResponse('{"title":"Test"}');
    expect(result).toEqual({ title: "Test" });
  });

  it("parseert JSON in markdown fence", () => {
    const result = parseJsonFromLlmResponse('```json\n{"a":1}\n```');
    expect(result).toEqual({ a: 1 });
  });

  it("verwijdert trailing comma", () => {
    const result = parseJsonFromLlmResponse('{"a":1,}');
    expect(result).toEqual({ a: 1 });
  });

  it("extraheert JSON uit omringende tekst", () => {
    const result = parseJsonFromLlmResponse('Hier is het: {"ok":true} — klaar.');
    expect(result).toEqual({ ok: true });
  });

  it("gooit bij leeg antwoord", () => {
    expect(() => parseJsonFromLlmResponse("   ")).toThrow(/Leeg antwoord/);
  });
});
