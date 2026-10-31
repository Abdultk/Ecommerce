import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Tests run outside React Server Components; Next resolves the real guard at build time.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // Full checkout flows type into a dozen fields; 5s is too tight on a loaded machine or CI runner.
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: ["src/components/**", "src/lib/**"],
      exclude: ["**/*.test.{ts,tsx}"],
      reporter: ["text-summary", "text", "json-summary"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
