/**
 * tests.js — Basic automated tests (no external test framework needed).
 * Run: node tests.js
 * (Server must be running on localhost:3000)
 */

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
}

// ─── Part 1: Rate Limiter Tests ───────────────────────────────────────────

async function runRateLimiterTests() {
  console.log("\n[Part 1] Rate Limiter");

  await test("POST /request — valid request returns 201", async () => {
    const { status, body } = await post("/request", {
      user_id: "test-user-1",
      payload: { action: "click" },
    });
    assert(status === 201, `Expected 201, got ${status}`);
    assert(body.status === "accepted", "Expected status=accepted");
  });

  await test("POST /request — missing user_id returns 400", async () => {
    const { status } = await post("/request", { payload: {} });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test("POST /request — empty user_id returns 400", async () => {
    const { status } = await post("/request", { user_id: "  ", payload: {} });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test("POST /request — missing payload returns 400", async () => {
    const { status } = await post("/request", { user_id: "u1" });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test("POST /request — 6th request returns 429", async () => {
    const uid = `rl-user-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      await post("/request", { user_id: uid, payload: i });
    }
    const { status, body } = await post("/request", {
      user_id: uid,
      payload: "overflow",
    });
    assert(status === 429, `Expected 429, got ${status}`);
    assert(body.error !== undefined, "Expected error message");
  });

  await test("GET /stats — returns per-user stats", async () => {
    const { status, body } = await get("/stats");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(body.users), "Expected users array");
    assert(body.global !== undefined, "Expected global totals");
  });
}

// ─── Part 2: Product Catalog Tests ───────────────────────────────────────

async function runProductTests() {
  console.log("\n[Part 2] Product Catalog");
  const testSku = `TEST-SKU-${Date.now()}`;
  let createdId;

  await test("POST /products — creates product, returns 201", async () => {
    const { status, body } = await post("/products", {
      name: "Test Widget",
      sku: testSku,
      image_urls: [
        "https://cdn.example.com/img1.jpg",
        "https://cdn.example.com/img2.jpg",
      ],
      video_urls: ["https://cdn.example.com/demo.mp4"],
    });
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.id, "Expected id in response");
    assert(body.name === "Test Widget", "Name mismatch");
    assert(body.image_urls.length === 2, "Expected 2 image_urls");
    createdId = body.id;
  });

  await test("POST /products — duplicate sku returns 409", async () => {
    const { status } = await post("/products", {
      name: "Duplicate",
      sku: testSku,
    });
    assert(status === 409, `Expected 409, got ${status}`);
  });

  await test("POST /products — missing name returns 400", async () => {
    const { status } = await post("/products", { sku: "SKU-NONAME" });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test("POST /products — invalid URL returns 400", async () => {
    const { status } = await post("/products", {
      name: "Bad URL Product",
      sku: `BAD-${Date.now()}`,
      image_urls: ["not-a-url"],
    });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test("GET /products — returns paginated list without full URL arrays", async () => {
    const { status, body } = await get("/products?limit=5&offset=0");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(body.items), "Expected items array");
    assert(body.total !== undefined, "Expected total");
    assert(body.limit === 5, "Expected limit=5");
    // List items must NOT have image_urls or video_urls arrays
    for (const item of body.items) {
      assert(item.image_urls === undefined, "List must not expose image_urls");
      assert(item.video_urls === undefined, "List must not expose video_urls");
      assert(item.image_count !== undefined, "List must have image_count");
    }
  });

  await test("GET /products/:id — returns full detail", async () => {
    if (!createdId) return;
    const { status, body } = await get(`/products/${createdId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(body.image_urls), "Expected image_urls array");
    assert(Array.isArray(body.video_urls), "Expected video_urls array");
  });

  await test("GET /products/:id — unknown id returns 404", async () => {
    const { status } = await get("/products/nonexistent-id-xyz");
    assert(status === 404, `Expected 404, got ${status}`);
  });

  await test("POST /products/:id/media — appends media", async () => {
    if (!createdId) return;
    const { status, body } = await post(`/products/${createdId}/media`, {
      image_urls: ["https://cdn.example.com/new-img.jpg"],
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.image_count === 3, `Expected image_count=3, got ${body.image_count}`);
  });

  await test("POST /products/:id/media — empty body returns 400", async () => {
    if (!createdId) return;
    const { status } = await post(`/products/${createdId}/media`, {});
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test("POST /products/:id/media — unknown product 404", async () => {
    const { status } = await post("/products/bad-id/media", {
      image_urls: ["https://cdn.example.com/x.jpg"],
    });
    assert(status === 404, `Expected 404, got ${status}`);
  });
}

async function main() {
  console.log(`Running tests against ${BASE}`);
  await runRateLimiterTests();
  await runProductTests();
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner failed:", err.message);
  process.exit(1);
});
