import { describe, expect, it } from "vitest";
import { mergeConversationTranscripts } from "../src/services/conversation-pipeline.js";
import { ConversationAnalysisSchema } from "../src/types/visit-report.js";

describe("mergeConversationTranscripts", () => {
  it("voegt chunk-transcripten samen", () => {
    const merged = mergeConversationTranscripts([
      "[Accountmanager]: Hallo",
      "[Klant]: Goedemiddag",
    ]);
    expect(merged).toContain("Deel 1");
    expect(merged).toContain("Deel 2");
    expect(merged).toContain("Hallo");
  });

  it("laat enkel chunk ongewijzigd", () => {
    expect(mergeConversationTranscripts(["alleen tekst"])).toBe("alleen tekst");
  });
});

describe("ConversationAnalysisSchema", () => {
  it("valideert lege analyse", () => {
    expect(ConversationAnalysisSchema.safeParse({}).success).toBe(true);
  });
});
