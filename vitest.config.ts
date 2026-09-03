import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Creative projects may carry their own test runners and conventions. Keep
    // Figment's root suite scoped to the framework tests it owns.
    include: ["tests/**/*.test.{js,jsx,mjs,cjs,ts,tsx}"],
  },
});
