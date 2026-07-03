import { describe, expect, it } from "vitest";
import {
  isLocalShareStorageEnabled,
  isOutlookComposeAutomationEnabled,
  isSafeBezoekverslagFilename,
  resolveBezoekverslagenDir,
} from "../src/lib/bezoekverslagen-dir.js";
import {
  buildGespreksverslagBasename,
  sanitizeFilenameSegment,
} from "../src/services/gespreksverslag-export.js";

describe("resolveBezoekverslagenDir", () => {
  it("gebruikt Bezoekverslagen in projectroot", () => {
    expect(resolveBezoekverslagenDir("/project")).toMatch(/Bezoekverslagen$/);
  });
});

describe("isSafeBezoekverslagFilename", () => {
  it("accepteert geldige bestandsnamen", () => {
    expect(isSafeBezoekverslagFilename("gespreksverslag-kick-off-acme.docx")).toBe(true);
    expect(isSafeBezoekverslagFilename("gespreksverslag-kick-off-acme-28-05-2026.pdf")).toBe(
      true,
    );
  });

  it("weigert path traversal", () => {
    expect(isSafeBezoekverslagFilename("../secret.docx")).toBe(false);
    expect(isSafeBezoekverslagFilename("other-report.docx")).toBe(false);
  });
});

describe("buildGespreksverslagBasename", () => {
  it("voegt datumslug toe voor unieke bestandsnamen", () => {
    expect(
      buildGespreksverslagBasename("Kick-off Acme", "28-05-2026, 11:27"),
    ).toBe("gespreksverslag-kick-off-acme-28-05-2026-1127");
  });

  it("deelt sanitize-logica met frontend", () => {
    expect(sanitizeFilenameSegment("Interview (deels) 28-05-2026, 11:27")).toBe(
      "interview-deels-28-05-2026-1127",
    );
  });
});

describe("share environment flags", () => {
  it("schakelt lokale opslag uit op Vercel", () => {
    const prev = process.env.VERCEL;
    process.env.VERCEL = "1";
    expect(isLocalShareStorageEnabled()).toBe(false);
    process.env.VERCEL = prev;
  });

  it("outlook-automation alleen op Windows lokaal", () => {
    const prevVercel = process.env.VERCEL;
    delete process.env.VERCEL;
    const expected = process.platform === "win32";
    expect(isOutlookComposeAutomationEnabled()).toBe(expected);
    process.env.VERCEL = prevVercel;
  });
});
