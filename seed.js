/**
 * seed.js — Optional seed script for performance testing.
 * Creates 1,000 products with 10 image URLs each.
 * Run: node seed.js
 * (Server must be running on localhost:3000)
 */

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

async function seed() {
  console.log("Seeding 1,000 products with 10 images each...");
  let created = 0;
  let failed = 0;

  for (let i = 1; i <= 1000; i++) {
    const sku = `SKU-${String(i).padStart(5, "0")}`;
    const image_urls = Array.from(
      { length: 10 },
      (_, j) =>
        `https://cdn.example.com/products/${sku.toLowerCase()}/img-${j + 1}.jpg`
    );
    const video_urls = [
      `https://cdn.example.com/products/${sku.toLowerCase()}/demo.mp4`,
    ];

    try {
      const res = await fetch(`${BASE}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Product ${i}`,
          sku,
          image_urls,
          video_urls,
        }),
      });

      if (res.status === 201) {
        created++;
      } else {
        failed++;
        const body = await res.json();
        console.error(`Failed for ${sku}:`, body.error);
      }
    } catch (err) {
      failed++;
      console.error(`Error for ${sku}:`, err.message);
    }

    if (i % 100 === 0) {
      console.log(`  Progress: ${i}/1000`);
    }
  }

  console.log(`\nDone! Created: ${created}, Failed: ${failed}`);
  console.log(
    `\nNow test GET /products?limit=20 — it should be instant even with 10,000 URLs in memory.`
  );
}

seed();
