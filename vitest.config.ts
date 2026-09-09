import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws on import outside a React Server Component, which
      // is what a unit test is. Next.js still enforces the real boundary at
      // build time; this alias only makes the module importable here.
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Default `forks` pool reliably hangs (worker spawn timeout) in some
    // sandboxed/dev environments on this machine; `threads` runs the same
    // suite in-process via worker_threads and has been confirmed reliable.
    // See: 36/36 tests pass with --pool=threads vs. indefinite hang with forks.
    pool: "threads",
  },
});
