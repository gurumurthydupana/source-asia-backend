# Source Asia — Backend Assignment

> **Language:** Node.js (v18+) with Express  
> **AI Tools used:** Claude (Anthropic) — assisted with boilerplate structuring and README formatting. All logic, data model decisions, and design choices are my own.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (default port 3000)
npm start

# Run automated tests (server must be running)
npm test

# Optional: seed 1,000 products for performance testing
npm run seed
```

The server listens on `http://localhost:3000` by default. Set `PORT` env var to override:
```bash
PORT=8080 npm start
```

---

## Part 1 — Rate-Limited API

### Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Window type | **Fixed 1-minute window** | Simpler, predictable. Resets at the 60s boundary from first request. Documented limitation: burst of 10 requests possible at window boundary. |
| Rejected counter | **Cumulative across all windows** | More informative for ops; tells you total overload events per user, not just the current window. Documented in stats response. |
| Success status | **201 Created** | A new "request record" is created server-side. Matches REST semantics. |
| Rate limit response | **429 Too Many Requests** | Standard HTTP status for this exact case. |

### Endpoints

#### `POST /request`

**Request body:**
```json
{
  "user_id": "alice",
  "payload": { "action": "click", "item_id": 42 }
}
```

**201 Created (success):**
```json
{
  "status": "accepted",
  "user_id": "alice",
  "message": "Request accepted successfully",
  "accepted_at": "2025-05-20T10:00:00.000Z"
}
```

**429 Too Many Requests:**
```json
{
  "status": "rejected",
  "user_id": "alice",
  "error": "Rate limit exceeded. Maximum 5 requests per minute allowed per user.",
  "retry_after_seconds": 60
}
```

**400 Bad Request (invalid input):**
```json
{ "error": "user_id is required and must be a non-empty string" }
```

#### `GET /stats`

**Response schema:**
```json
{
  "generated_at": "2025-05-20T10:00:00.000Z",
  "window_duration_seconds": 60,
  "global": {
    "total_accepted": 12,
    "total_rejected": 3
  },
  "users": [
    {
      "user_id": "alice",
      "window_start": "2025-05-20T09:59:10.000Z",
      "window_end": "2025-05-20T10:00:10.000Z",
      "accepted_in_window": 5,
      "rejected_cumulative": 2,
      "window_active": true
    }
  ]
}
```

- `accepted_in_window`: count in the **current** 1-minute window (resets to 0 after window expires)
- `rejected_cumulative`: **total** rejections since the user was first seen (does not reset per window)

### Concurrency Safety

Node.js runs JavaScript on a single thread with a non-blocking event loop. Since all state mutations (`record.accepted++`, `record.rejected++`) happen synchronously within a single event-loop tick, there are no race conditions. No locks or mutexes are needed.

### curl Examples

```bash
# Send a valid request
curl -X POST http://localhost:3000/request \
  -H "Content-Type: application/json" \
  -d '{"user_id": "alice", "payload": {"action": "buy"}}'

# Exceed the rate limit (run 6 times in < 1 minute)
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/request \
    -H "Content-Type: application/json" \
    -d '{"user_id": "bob", "payload": '$i'}'
done

# Check stats
curl http://localhost:3000/stats
```

### Production Limitations (Part 1)

1. **Single instance only** — state lives in one Node.js process. Horizontal scaling requires a shared store (Redis, Memcached).
2. **Restart loses state** — all window counters reset. Add Redis with TTL-keyed counters for persistence.
3. **Fixed window burst** — a user can send 5 requests at 00:59 and 5 more at 01:01 (10 in 2 seconds). Use a sliding window or token bucket for stricter limits.
4. **No user authentication** — `user_id` is self-declared. In production, extract it from a verified JWT or session token.

---

## Part 2 — Product Catalog with Media

### Data Model

Storage is split into two in-memory Maps for performance:

```
products  Map<id, ProductSummary>
  └─ { id, name, sku, image_count, video_count, thumbnail_url, created_at }

media     Map<id, MediaRecord>
  └─ { image_urls: string[], video_urls: string[] }

skuIndex  Map<sku, id>   ← O(1) duplicate-SKU detection
```

**Why split?**

`GET /products` (list) reads only from `products` — it never opens the `media` Map. With 1,000 products × 10 images each, the list endpoint serialises exactly 0 URL strings; it just returns `image_count: 10`. The 10,000 URLs sit in `media`, untouched, until `GET /products/:id` needs them.

### Validation Rules

| Rule | Detail |
|---|---|
| `name` | Required, non-empty string |
| `sku` | Required, non-empty string, globally unique |
| URL format | Must start with `http://` or `https://`, max 2048 chars |
| URLs per request | Max **20** per array per request (image_urls and video_urls separately) |
| No binary/base64 | Only URL strings accepted — no file uploads |

### Endpoints

#### `POST /products` → 201 Created

```bash
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Widget A",
    "sku": "SKU-001",
    "image_urls": [
      "https://cdn.example.com/products/sku-001/img-1.jpg",
      "https://cdn.example.com/products/sku-001/img-2.jpg"
    ],
    "video_urls": [
      "https://cdn.example.com/products/sku-001/demo.mp4"
    ]
  }'
```

Response includes all fields including full URL arrays. Duplicate SKU → **409 Conflict**.

#### `GET /products` → 200 OK (paginated, lean)

```bash
curl "http://localhost:3000/products?limit=20&offset=0"
```

**Query params:**

| Param | Default | Max |
|---|---|---|
| `limit` | 20 | 100 |
| `offset` | 0 | — |

**Response (list item shape — no URL arrays):**
```json
{
  "total": 1000,
  "limit": 20,
  "offset": 0,
  "items": [
    {
      "id": "uuid",
      "name": "Widget A",
      "sku": "SKU-001",
      "image_count": 2,
      "video_count": 1,
      "thumbnail_url": "https://cdn.example.com/products/sku-001/img-1.jpg",
      "created_at": "2025-05-20T10:00:00.000Z"
    }
  ]
}
```

#### `GET /products/:id` → 200 OK (full detail)

```bash
curl http://localhost:3000/products/<id>
```

Returns the full product including `image_urls` and `video_urls` arrays. Unknown id → **404**.

#### `POST /products/:id/media` → 200 OK

```bash
curl -X POST http://localhost:3000/products/<id>/media \
  -H "Content-Type: application/json" \
  -d '{
    "image_urls": ["https://cdn.example.com/products/sku-001/img-3.jpg"],
    "video_urls": []
  }'
```

Appends URLs. At least one of `image_urls` or `video_urls` must be non-empty → otherwise **400**. Unknown id → **404**.

### Performance Rule — Verified

With 1,000 products and 10 image URLs each:

- `GET /products?limit=20` reads 20 lean summary objects from `products` Map. Zero URL strings loaded.
- Only `GET /products/:id` triggers a `media` Map lookup for that single product.

Seed the server with `npm run seed` and benchmark both endpoints to verify.

### What Would Change with PostgreSQL + CDN

| Concern | In-memory (now) | PostgreSQL + CDN (production) |
|---|---|---|
| List query | Slice a sorted array | `SELECT id, name, sku, image_count, thumbnail_url FROM products LIMIT 20 OFFSET 0` — images stored in a separate `product_media` table, never joined on list |
| Detail query | Two Map lookups | JOIN `products` + `product_media` on `product_id` |
| Media URLs | Stored as strings | Store relative paths; prepend CDN base URL at read time for cache-busting / multi-region support |
| SKU uniqueness | Map index | Unique index on `sku` column — DB enforces it |
| Persistence | Lost on restart | Full ACID durability |
| Horizontal scale | Single process | Stateless API pods; all state in DB + CDN |
| Pagination | Sort in JS | `ORDER BY created_at DESC` with a cursor-based approach for deep pages |

---

## Project Structure

```
source-asia-backend/
├── index.js          # Express app + all route handlers
├── src/
│   ├── rateLimiter.js  # Fixed-window rate limiter (Part 1)
│   └── productStore.js # Split in-memory product store (Part 2)
├── tests.js          # Automated test suite (no external framework)
├── seed.js           # Optional: seeds 1,000 products for perf testing
├── package.json
└── README.md
```

---

## Running Tests

```bash
# Terminal 1
npm start

# Terminal 2
npm test
```

Expected output: all tests passing with ✓ marks.
