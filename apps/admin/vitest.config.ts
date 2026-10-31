import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@test": fileURLToPath(new URL("./test", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    // Form tests type many fields with userEvent; under a full parallel run they need more than 5 s.
    testTimeout: 20_000,
    env: { NEXT_PUBLIC_API_URL: "http://localhost:4000/api/v1" },
    coverage: {
      provider: "v8",
      include: ["src/components/**", "src/lib/**"],
      reporter: ["text", "html", "lcov", "json-summary"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
