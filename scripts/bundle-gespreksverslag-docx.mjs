import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  entryPoints: [path.join(root, "public/js/gespreksverslag-docx.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: path.join(root, "public/js/gespreksverslag-docx.bundle.js"),
  legalComments: "none",
  logLevel: "info",
});
