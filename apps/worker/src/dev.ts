import { createApp } from "./index";
import { d1Shim, type DevDatabase } from "./dev/database";
import { kvBucket } from "./dev/media";
import { serveSingleHost, singleHostFor } from "./hosts";

/**
 * Entry point of the dev deployment (wrangler.dev.jsonc). The same app as production, with
 * the database in a Durable Object, images in KV and everything under one workers.dev address.
 * No D1, R2 or wildcard domain needed, so it deploys with a plain Worker upload.
 */

export { DevDatabase } from "./dev/database";

interface DevBindings {
  DEV_DB: DurableObjectNamespace<DevDatabase>;
  DEV_MEDIA: KVNamespace;
}

const app = createApp();

export default {
  fetch(req: Request, rawEnv: Env & DevBindings, ctx: ExecutionContext) {
    const env = { ...rawEnv, DB: d1Shim(rawEnv.DEV_DB), MEDIA: kvBucket(rawEnv.DEV_MEDIA) } as Env;
    const h = singleHostFor(env, req);
    return h ? serveSingleHost(h, req, async (r) => app.fetch(r, env, ctx)) : app.fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env & DevBindings>;
