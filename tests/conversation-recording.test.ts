import { describe, expect, it } from "vitest";
import {
  SEGMENT_ROLLOVER_SECONDS,
  getSegmentElapsedSeconds,
  shouldRolloverSegment,
  splitAudioBlob,
} from "../public/js/conversation-recording.js";

const SEGMENT_ROLLOVER_BYTES = 20 * 1024 * 1024;

describe("conversation segment rollover helpers", () => {
  it("SEGMENT_ROLLOVER_SECONDS blijft onder OpenAI diarize-limiet (~1400 s)", () => {
    expect(SEGMENT_ROLLOVER_SECONDS).toBe(1200);
    expect(SEGMENT_ROLLOVER_SECONDS).toBeLessThan(1400);
  });

  describe("getSegmentElapsedSeconds", () => {
    it("berekent verstreken seconden sinds segment-start", () => {
      const startedAt = 1_000_000;
      expect(getSegmentElapsedSeconds(startedAt, startedAt + 65_000)).toBe(65);
    });

    it("geeft 0 terug zonder starttijd", () => {
      expect(getSegmentElapsedSeconds(0)).toBe(0);
    });
  });

  describe("shouldRolloverSegment", () => {
    it("rollover bij segmentduur >= 1200 s", () => {
      expect(shouldRolloverSegment(1199, 0)).toBe(false);
      expect(shouldRolloverSegment(1200, 0)).toBe(true);
      expect(shouldRolloverSegment(1500, 0)).toBe(true);
    });

    it("rollover bij segmentgrootte >= 20 MB", () => {
      expect(shouldRolloverSegment(0, SEGMENT_ROLLOVER_BYTES - 1)).toBe(false);
      expect(shouldRolloverSegment(0, SEGMENT_ROLLOVER_BYTES)).toBe(true);
    });

    it("geen rollover onder beide drempels", () => {
      expect(shouldRolloverSegment(600, 5 * 1024 * 1024)).toBe(false);
    });

    it("rollover wanneer één van beide drempels bereikt is", () => {
      expect(shouldRolloverSegment(1200, 5 * 1024 * 1024)).toBe(true);
      expect(shouldRolloverSegment(600, SEGMENT_ROLLOVER_BYTES)).toBe(true);
    });
  });
});

describe("splitAudioBlob", () => {
  it("laat kleine blobs ongemoeid", () => {
    const blob = new Blob(["x"], { type: "audio/webm" });
    expect(splitAudioBlob(blob)).toEqual([blob]);
  });

  it("splitst blobs groter dan 24 MB", () => {
    const size = 25 * 1024 * 1024;
    const blob = new Blob([new Uint8Array(size)], { type: "audio/webm" });
    const parts = splitAudioBlob(blob);
    expect(parts.length).toBe(2);
    expect(parts[0].size).toBe(24 * 1024 * 1024);
    expect(parts[1].size).toBe(1024 * 1024);
  });
});
