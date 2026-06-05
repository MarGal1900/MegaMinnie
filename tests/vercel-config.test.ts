import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const config = JSON.parse(
  readFileSync(resolve(__dirname, "../vercel.json"), "utf8"),
);

describe("vercel.json structuur", () => {
  it("is valide JSON met de verwachte toplevel-sleutels", () => {
    expect(config).toHaveProperty("buildCommand");
    expect(config).toHaveProperty("headers");
    expect(Array.isArray(config.headers)).toBe(true);
  });

  it("heeft een functions-configuratie voor api/index.js met includeFiles", () => {
    expect(config).toHaveProperty("functions");
    expect(config.functions).toHaveProperty("api/index.js");
    expect(config.functions["api/index.js"].includeFiles).toContain("dist/**");
    expect(config.functions["api/index.js"].includeFiles).toContain("public/**");
  });

  it("heeft een rewrite die alle requests naar /api/index stuurt", () => {
    expect(Array.isArray(config.rewrites)).toBe(true);
    const rewrite = config.rewrites.find(
      (r: { source: string }) => r.source === "/(.*)",
    );
    expect(rewrite).toBeDefined();
    expect(rewrite.destination).toBe("/api/index");
  });

  it("bevat een Cache-Control: no-cache regel voor /sw.js", () => {
    const rule = config.headers.find(
      (r: { source: string }) => r.source === "/sw.js",
    );
    expect(rule).toBeDefined();

    const header = rule.headers.find(
      (h: { key: string }) => h.key === "Cache-Control",
    );
    expect(header).toBeDefined();
    expect(header.value).toBe("public, max-age=0, must-revalidate");
  });

  it("behoudt de Permissions-Policy regel voor alle routes", () => {
    const rule = config.headers.find(
      (r: { source: string }) => r.source === "/(.*)",
    );
    expect(rule).toBeDefined();

    const header = rule.headers.find(
      (h: { key: string }) => h.key === "Permissions-Policy",
    );
    expect(header).toBeDefined();
    expect(header.value).toContain("microphone=(self)");
    expect(header.value).toContain("camera=(self)");
  });

  it("/sw.js regel staat vóór de wildcard regel", () => {
    const swIndex = config.headers.findIndex(
      (r: { source: string }) => r.source === "/sw.js",
    );
    const wildcardIndex = config.headers.findIndex(
      (r: { source: string }) => r.source === "/(.*)",
    );
    expect(swIndex).toBeGreaterThanOrEqual(0);
    expect(wildcardIndex).toBeGreaterThanOrEqual(0);
    expect(swIndex).toBeLessThan(wildcardIndex);
  });
});
