import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds the React front end into dist/client, which the Worker serves as static assets.
export default defineConfig({
  root: "src/client",
  plugins: [react()],
  build: { outDir: "../../dist/client", emptyOutDir: true },
});
