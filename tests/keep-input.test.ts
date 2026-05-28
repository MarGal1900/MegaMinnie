import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isKeepInputEnabled } from "../src/lib/keep-input.js";

describe("isKeepInputEnabled", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("returns true when MEGAMINNIE_KEEP_INPUT=true", () => {
    process.env.MEGAMINNIE_KEEP_INPUT = "true";
    expect(isKeepInputEnabled()).toBe(true);
  });

  it("returns false when MEGAMINNIE_KEEP_INPUT=false", () => {
    process.env.MEGAMINNIE_KEEP_INPUT = "false";
    expect(isKeepInputEnabled()).toBe(false);
  });

  it("defaults to true when unset and dry-run is active", () => {
    delete process.env.MEGAMINNIE_KEEP_INPUT;
    process.env.MEGAMINNIE_DRY_RUN = "true";
    expect(isKeepInputEnabled()).toBe(true);
  });

  it("defaults to false when unset and dry-run is off", () => {
    delete process.env.MEGAMINNIE_KEEP_INPUT;
    process.env.MEGAMINNIE_DRY_RUN = "false";
    expect(isKeepInputEnabled()).toBe(false);
  });
});
