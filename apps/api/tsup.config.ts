import { defineConfig } from "tsup";

// Bundles our own source into one ESM file; npm dependencies stay external.
export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
});
