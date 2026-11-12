export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 8000;
/** Widths we pre-render. Any other requested width snaps to the nearest one above, so the cache stays small. */
export const IMAGE_WIDTHS = [320, 640, 1280] as const;

const EXT: Record<(typeof IMAGE_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export class MediaError extends Error {}

const streamOf = (body: ArrayBuffer) => new Blob([body]).stream();

/**
 * Media files of one tenant in R2. Every key starts with the tenant id, so tenants never share files.
 * With the Images binding, uploads are checked to really be images and smaller copies are made on demand.
 */
export class Media {
  constructor(
    private bucket: R2Bucket,
    readonly tenantId: string,
    private images?: ImagesBinding,
  ) {}

  private owns(key: string): boolean {
    return key.startsWith(`${this.tenantId}/`) && !key.includes("..");
  }

  async putImage(body: ArrayBuffer, contentType: string): Promise<string> {
    const type = IMAGE_TYPES.find((t) => t === contentType);
    if (!type) throw new MediaError(`Unsupported image type: ${contentType}`);
    if (body.byteLength > MAX_IMAGE_BYTES) throw new MediaError("Image is larger than 5 MB");
    if (this.images) {
      // Trust the bytes, not the label the browser sent.
      const info = await this.images.info(streamOf(body)).catch(() => null);
      if (!info || !("width" in info) || !IMAGE_TYPES.some((t) => t === info.format)) {
        throw new MediaError("File is not a supported image");
      }
      if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE) throw new MediaError("Image is too large");
    }
    const key = `${this.tenantId}/images/${crypto.randomUUID()}.${EXT[type]}`;
    await this.bucket.put(key, body, { httpMetadata: { contentType: type } });
    return key;
  }

  /** Returns the object only when the key belongs to this tenant. */
  async get(key: string): Promise<R2ObjectBody | null> {
    return this.owns(key) ? this.bucket.get(key) : null;
  }

  /**
   * A WebP copy no wider than `width` (snapped to IMAGE_WIDTHS), made once and kept in R2.
   * Falls back to the original when resizing is not available or fails, so a page never shows a broken image.
   */
  async variant(key: string, width: number): Promise<R2ObjectBody | null> {
    if (!this.owns(key) || /\.w\d+\.webp$/.test(key)) return null;
    const w = IMAGE_WIDTHS.find((x) => x >= width) ?? IMAGE_WIDTHS.at(-1)!;
    const variantKey = `${key}.w${w}.webp`;
    const cached = await this.bucket.get(variantKey);
    if (cached) return cached;
    const original = await this.bucket.get(key);
    if (!original || !this.images) return original;
    try {
      const result = await this.images
        .input(original.body)
        .transform({ width: w, fit: "scale-down" })
        .output({ format: "image/webp", quality: 80 });
      const bytes = await new Response(result.image()).arrayBuffer();
      await this.bucket.put(variantKey, bytes, { httpMetadata: { contentType: "image/webp" } });
      return await this.bucket.get(variantKey);
    } catch (error) {
      console.error(`Resize failed for ${key}`, error);
      return this.bucket.get(key);
    }
  }

  /** Deletes the file and every resized copy of it. */
  async delete(key: string): Promise<void> {
    if (!this.owns(key)) return;
    await this.bucket.delete([key, ...IMAGE_WIDTHS.map((w) => `${key}.w${w}.webp`)]);
  }
}
