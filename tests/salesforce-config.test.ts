import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getSalesforceConfigStatus } from "../src/lib/salesforce-config.js";

describe("getSalesforceConfigStatus", () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.SF_CLIENT_ID;
    delete process.env.SF_CLIENT_SECRET;
    delete process.env.SF_USERNAME;
    delete process.env.SF_PASSWORD;
    process.env.MEGAMINNIE_DRY_RUN = "true";
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("detecteert ontbrekende variabelen", () => {
    const status = getSalesforceConfigStatus();
    expect(status.configured).toBe(false);
    expect(status.missing).toContain("SF_CLIENT_ID");
    expect(status.missing).toContain("SF_PASSWORD");
    expect(status.dryRun).toBe(true);
    expect(status.liveUploadEnabled).toBe(false);
  });

  it("markeert live upload wanneer compleet en dry run uit", () => {
    process.env.SF_CLIENT_ID = "id";
    process.env.SF_CLIENT_SECRET = "secret";
    process.env.SF_USERNAME = "user@example.com";
    process.env.SF_PASSWORD = "pass";
    process.env.MEGAMINNIE_DRY_RUN = "false";

    const status = getSalesforceConfigStatus();
    expect(status.configured).toBe(true);
    expect(status.missing).toEqual([]);
    expect(status.liveUploadEnabled).toBe(true);
  });
});
