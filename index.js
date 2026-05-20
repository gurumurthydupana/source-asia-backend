"use strict";

const express = require("express");
const rateLimiter = require("./src/rateLimiter");
const productStore = require("./src/productStore");

const app = express();
app.use(express.json());

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — Rate-Limited API
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /request
 * Accepts or rate-limits a user's request.
 * Returns 201 on success, 429 when rate limit exceeded, 400 on bad input.
 */
app.post("/request", (req, res) => {
  const { user_id, payload } = req.body ?? {};

  // Input validation
  if (
    req.body === undefined ||
    req.body === null ||
    typeof req.body !== "object"
  ) {
    return res.status(400).json({ error: "Request body must be valid JSON" });
  }
  if (!user_id || typeof user_id !== "string" || user_id.trim() === "") {
    return res
      .status(400)
      .json({ error: "user_id is required and must be a non-empty string" });
  }
  if (payload === undefined) {
    return res.status(400).json({ error: "payload is required" });
  }

  const userId = user_id.trim();
  const result = rateLimiter.consume(userId);

  if (result.allowed) {
    return res.status(201).json({
      status: "accepted",
      user_id: userId,
      message: "Request accepted successfully",
      accepted_at: new Date().toISOString(),
    });
  } else {
    return res.status(429).json({
      status: "rejected",
      user_id: userId,
      error:
        "Rate limit exceeded. Maximum 5 requests per minute allowed per user.",
      retry_after_seconds: 60,
    });
  }
});

/**
 * GET /stats
 * Returns per-user statistics for the current window.
 */
app.get("/stats", (req, res) => {
  const userStats = rateLimiter.getStats();

  const global = userStats.reduce(
    (acc, s) => {
      acc.total_accepted += s.accepted_in_window;
      acc.total_rejected += s.rejected_cumulative;
      return acc;
    },
    { total_accepted: 0, total_rejected: 0 }
  );

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    window_duration_seconds: 60,
    global,
    users: userStats,
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — Product Catalog with Media
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /products
 * Creates a new product. Returns 201 with the full product on success.
 */
app.post("/products", (req, res) => {
  const body = req.body ?? {};
  const { name, sku, image_urls, video_urls } = body;

  const result = productStore.create({
    name,
    sku,
    image_urls: image_urls ?? [],
    video_urls: video_urls ?? [],
  });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(201).json(result.product);
});

/**
 * GET /products
 * Paginated product list. Returns lean summaries — no full URL arrays.
 * Query params: limit (default 20, max 100), offset (default 0)
 */
app.get("/products", (req, res) => {
  const { limit, offset } = req.query;
  const result = productStore.list({ limit, offset });

  return res.status(200).json(result.data);
});

/**
 * GET /products/:id
 * Full product detail including all image_urls and video_urls.
 */
app.get("/products/:id", (req, res) => {
  const result = productStore.getById(req.params.id);

  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(200).json(result.product);
});

/**
 * POST /products/:id/media
 * Appends new image or video URLs to an existing product.
 */
app.post("/products/:id/media", (req, res) => {
  const body = req.body ?? {};
  const { image_urls, video_urls } = body;

  const result = productStore.appendMedia(req.params.id, {
    image_urls: image_urls ?? [],
    video_urls: video_urls ?? [],
  });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(200).json(result.product);
});

// ═══════════════════════════════════════════════════════════════════════
// Start server
// ═══════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Source Asia Backend running on http://localhost:${PORT}`);
  console.log(`Part 1 — Rate-limited API: POST /request | GET /stats`);
  console.log(
    `Part 2 — Product catalog: POST /products | GET /products | GET /products/:id | POST /products/:id/media`
  );
});

// Graceful shutdown
process.on("SIGTERM", () => {
  rateLimiter.destroy();
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  rateLimiter.destroy();
  server.close(() => process.exit(0));
});

module.exports = app;
