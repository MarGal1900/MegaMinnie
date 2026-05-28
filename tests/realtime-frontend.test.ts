import { describe, expect, it } from "vitest";
import { buildRealtimeCallsRequest } from "../public/js/realtime-interview.js";

describe("realtime frontend request builder", () => {
  it("bouwt GA calls request zonder server API key", () => {
    const form = buildRealtimeCallsRequest("v=0\no=- 1 2 IN IP4 127.0.0.1");
    expect(form.get("sdp")).toContain("IN IP4 127.0.0.1");
    expect(form.get("apiKey")).toBeNull();
    expect(form.get("OPENAI_API_KEY")).toBeNull();
  });
});
