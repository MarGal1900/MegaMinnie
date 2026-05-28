import { describe, expect, it } from "vitest";
import { getDefaultAccountManager } from "../src/lib/task-assignee-config.js";

describe("getDefaultAccountManager", () => {
  it("geeft env-waarde terug", () => {
    const prev = process.env.MEGAMINNIE_DEFAULT_ACCOUNT_MANAGER;
    process.env.MEGAMINNIE_DEFAULT_ACCOUNT_MANAGER = "Jan Jansen";
    expect(getDefaultAccountManager()).toBe("Jan Jansen");
    if (prev === undefined) delete process.env.MEGAMINNIE_DEFAULT_ACCOUNT_MANAGER;
    else process.env.MEGAMINNIE_DEFAULT_ACCOUNT_MANAGER = prev;
  });

  it("valt terug op Accountmanager", () => {
    const prev = process.env.MEGAMINNIE_DEFAULT_ACCOUNT_MANAGER;
    delete process.env.MEGAMINNIE_DEFAULT_ACCOUNT_MANAGER;
    expect(getDefaultAccountManager()).toBe("Accountmanager");
    if (prev !== undefined) process.env.MEGAMINNIE_DEFAULT_ACCOUNT_MANAGER = prev;
  });
});
