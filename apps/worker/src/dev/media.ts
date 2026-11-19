/**
 * Dev deployment only: image files in KV behind the few R2 calls core/media.ts makes
 * (put, get, delete). Values up to 25 MB, and uploads are capped at 5 MB anyway.
 */

interface Meta {
  contentType?: string;
}

function object(key: string, bytes: ArrayBuffer, meta: Meta | null) {
  return {
    key,
    size: bytes.byteLength,
    httpEtag: `"${key.length}-${bytes.byteLength}"`,
    httpMetadata: { contentType: meta?.contentType },
    body: new Response(bytes).body!,
    writeHttpMetadata(headers: Headers) {
      if (meta?.contentType) headers.set("content-type", meta.contentType);
    },
    arrayBuffer: async () => bytes,
  };
}

export function kvBucket(kv: KVNamespace): R2Bucket {
  const bucket = {
    async put(key: string, value: ArrayBuffer | ArrayBufferView | string, opts?: { httpMetadata?: Meta }) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
      await kv.put(key, bytes, { metadata: { contentType: opts?.httpMetadata?.contentType } });
      return null;
    },
    async get(key: string) {
      const { value, metadata } = await kv.getWithMetadata<Meta>(key, "arrayBuffer");
      return value ? object(key, value, metadata) : null;
    },
    async head(key: string) {
      const { value, metadata } = await kv.getWithMetadata<Meta>(key, "arrayBuffer");
      return value ? object(key, value, metadata) : null;
    },
    async delete(keys: string | string[]) {
      await Promise.all((Array.isArray(keys) ? keys : [keys]).map((k) => kv.delete(k)));
    },
  };
  return bucket as unknown as R2Bucket;
}
