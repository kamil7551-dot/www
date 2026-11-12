import { env } from "cloudflare:workers";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { qrMatrix, qrPng, qrSvg } from "./core-under-test";
import { harness, uniqueEmail } from "./panel-harness";

/** Renders the matrix to pixels and reads it back with a real decoder, like a phone camera would. */
function scan(matrix: boolean[][]): string | undefined {
  const scale = 8;
  const border = 4;
  const size = (matrix.length + border * 2) * scale;
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + border) * scale + dy) * size + (x + border) * scale + dx) * 4;
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
        }
    }),
  );
  return jsQR(rgba, size, size)?.data;
}

describe("QR code", () => {
  it("encodes the site address so a phone can read it", () => {
    const url = "https://bistro-pod-lipa.example.pl/";
    expect(scan(qrMatrix(url))).toBe(url);
  });

  it("makes a single-path SVG with an escaped label", () => {
    const svg = qrSvg("https://a.example/", { label: 'Kod <"x">' });
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg).toContain("<title>Kod &#60;&#34;x&#34;&#62;</title>");
  });

  it("makes a valid PNG big enough to print", async () => {
    const png = await qrPng("https://a.example/");
    const info = await env.IMAGES.info(new Blob([png]).stream());
    expect(info).toMatchObject({ format: "image/png" });
    expect((info as { width: number }).width).toBeGreaterThanOrEqual(900);
  });
});

describe("panel QR screens", () => {
  it("shows the code, offers downloads and a print sheet pointing at the site", async () => {
    const h = harness();
    await h.login(uniqueEmail());
    const path = await h.newSite("Bistro QR", "qr-menu");
    const page = await (await h.call(`${path}/qr`)).text();
    expect(page).toContain("<svg");
    expect(page).toMatch(/https:\/\/bistro-qr[\w-]*\.localhost\//);

    const svg = await h.call(`${path}/qr.svg`);
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg.headers.get("content-disposition")).toMatch(/attachment; filename="kod-qr-bistro-qr[\w-]*\.svg"/);
    expect((await h.call(`${path}/qr.png`)).headers.get("content-type")).toBe("image/png");

    const sheet = await (await h.call(`${path}/qr/print?n=6`)).text();
    expect(sheet.match(/class="qr-print-card"/g)).toHaveLength(6);
    expect(sheet).toContain("Zeskanuj, aby zobaczyć menu");
    expect(sheet).not.toContain("<script");
  });

  it("uses the site's own domain when it has one", async () => {
    const h = harness();
    await h.login(uniqueEmail());
    const path = await h.newSite("Domena QR", "business-card");
    const domain = `${crypto.randomUUID().slice(0, 8)}.example.pl`;
    await env.DB.prepare("INSERT INTO tenant_domains (domain, tenant_id) VALUES (?1, ?2)").bind(domain, path.split("/").pop()).run();
    expect(await (await h.call(`${path}/qr`)).text()).toContain(`https://${domain}/`);
  });

  it("is not available for other sellers' sites", async () => {
    const owner = harness();
    await owner.login(uniqueEmail());
    const path = await owner.newSite("Cudzy QR");
    const other = harness();
    await other.login(uniqueEmail());
    for (const p of ["/qr", "/qr.svg", "/qr.png", "/qr/print"]) expect((await other.call(path + p)).status).toBe(404);
  });
});
