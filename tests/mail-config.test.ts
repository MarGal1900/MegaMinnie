import { describe, expect, it } from "vitest";
import { getMailSignature } from "../src/lib/mail-config.js";

describe("getMailSignature", () => {
  it("leest handtekening uit env en zet \\n om naar regeleinden", () => {
    const prev = process.env.MEGAMINNIE_MAIL_SIGNATURE;
    process.env.MEGAMINNIE_MAIL_SIGNATURE = "Jan Jansen\\nCCS\\njan@example.com";
    expect(getMailSignature()).toBe("Jan Jansen\nCCS\njan@example.com");
    if (prev === undefined) delete process.env.MEGAMINNIE_MAIL_SIGNATURE;
    else process.env.MEGAMINNIE_MAIL_SIGNATURE = prev;
  });

  it("geeft lege string zonder env", () => {
    const prev = process.env.MEGAMINNIE_MAIL_SIGNATURE;
    delete process.env.MEGAMINNIE_MAIL_SIGNATURE;
    expect(getMailSignature()).toBe("");
    if (prev !== undefined) process.env.MEGAMINNIE_MAIL_SIGNATURE = prev;
  });
});
