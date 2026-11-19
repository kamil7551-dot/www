import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The dev deployment (wrangler.dev.jsonc): Durable Object database, KV images, one address.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.dev.jsonc" },
      miniflare: { bindings: { DEV_LOGIN_PASSWORD: "testowe-haslo-123" } },
    }),
  ],
  test: { include: ["test-dev/**/*.test.ts"] },
});
