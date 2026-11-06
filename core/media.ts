export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXT: Record<(typeof IMAGE_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export class MediaError extends Error {}

/** Media files of one tenant in R2. Every key starts with the tenant id, so tenants never share files. */
export class Media {
  constructor(
    private bucket: R2Bucket,
    readonly tenantId: string,
  ) {}

  async putImage(body: ArrayBuffer, contentType: string): Promise<string> {
    const type = IMAGE_TYPES.find((t) => t === contentType);
    if (!type) throw new MediaError(`Unsupported image type: ${contentType}`);
    if (body.byteLength > MAX_IMAGE_BYTES) throw new MediaError("Image is larger than 5 MB");
    const key = `${this.tenantId}/images/${crypto.randomUUID()}.${EXT[type]}`;
    await this.bucket.put(key, body, { httpMetadata: { contentType: type } });
    return key;
  }

  /** Returns the object only when the key belongs to this tenant. */
  async get(key: string): Promise<R2ObjectBody | null> {
    if (!key.startsWith(`${this.tenantId}/`) || key.includes("..")) return null;
    return this.bucket.get(key);
  }

  async delete(key: string): Promise<void> {
    if (key.startsWith(`${this.tenantId}/`)) await this.bucket.delete(key);
  }
}
