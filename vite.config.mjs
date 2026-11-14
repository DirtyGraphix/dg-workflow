import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = import.meta.dirname;

// The customer proof page is rendered by the Worker, not React, so it can also be served through
// dirtygraphix.com/apps/proof. It loads the same design tokens and fonts from fixed paths under /proof-assets/.
/** @returns {import("vite").Plugin} */
function proofAssets() {
  /** @type {[string, string][]} */
  const files = [
    ["design/tokens.css", "tokens.css"],
    ["src/proof/proof.css", "proof.css"],
    ["src/proof/proof.js", "proof.js"],
    ...["400", "500", "600", "700"].map((w) => [`node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2`, `fonts/inter-${w}.woff2`]),
    ...["600", "700"].map((w) => [`node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-${w}-normal.woff2`, `fonts/barlow-condensed-${w}.woff2`]),
  ];
  return {
    name: "proof-assets",
    closeBundle() {
      const out = resolve(root, "dist/client/proof-assets");
      mkdirSync(resolve(out, "fonts"), { recursive: true });
      for (const [from, to] of files) copyFileSync(resolve(root, from), resolve(out, to));
    },
  };
}

// Builds the React front end into dist/client, which the Worker serves as static assets.
export default defineConfig({
  root: "src/client",
  plugins: [react(), proofAssets()],
  build: { outDir: "../../dist/client", emptyOutDir: true },
});
