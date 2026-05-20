/**
 * ProductStore - In-memory storage for the product catalog.
 *
 * Data model (separation of concerns for performance):
 *   products   Map<id, ProductSummary>   — lean object, no URL arrays
 *   media      Map<id, MediaRecord>      — full URL arrays, loaded only for detail
 *
 * This means GET /products (list) never touches the media Map, satisfying the
 * performance requirement: 1000 products × 10 images each never get loaded or
 * serialised for a 20-item list page.
 */

const { v4: uuidv4 } = require("uuid");

const MAX_URL_LENGTH = 2048;
const MAX_URLS_PER_REQUEST = 20;
const URL_REGEX = /^https?:\/\/.{1,2040}$/;

class ProductStore {
  constructor() {
    // id -> { id, name, sku, image_count, video_count, thumbnail_url, created_at }
    this.products = new Map();
    // id -> { image_urls: [], video_urls: [] }
    this.media = new Map();
    // sku -> id  (for duplicate-sku detection in O(1))
    this.skuIndex = new Map();
  }

  // ─── Validation helpers ───────────────────────────────────────────────────

  _validateUrl(url) {
    if (typeof url !== "string") return false;
    if (url.length > MAX_URL_LENGTH) return false;
    return URL_REGEX.test(url);
  }

  _validateUrlArray(arr, fieldName) {
    if (!Array.isArray(arr)) {
      return { ok: false, error: `${fieldName} must be an array` };
    }
    if (arr.length > MAX_URLS_PER_REQUEST) {
      return {
        ok: false,
        error: `${fieldName} must not exceed ${MAX_URLS_PER_REQUEST} URLs per request`,
      };
    }
    for (const url of arr) {
      if (!this._validateUrl(url)) {
        return {
          ok: false,
          error: `Invalid URL in ${fieldName}: "${url}". Must be http/https, max ${MAX_URL_LENGTH} chars.`,
        };
      }
    }
    return { ok: true };
  }

  // ─── Create product ───────────────────────────────────────────────────────

  create({ name, sku, image_urls = [], video_urls = [] }) {
    // Required fields
    if (!name || typeof name !== "string" || name.trim() === "") {
      return { ok: false, status: 400, error: "name is required and must be non-empty" };
    }
    if (!sku || typeof sku !== "string" || sku.trim() === "") {
      return { ok: false, status: 400, error: "sku is required and must be non-empty" };
    }

    // Duplicate SKU
    if (this.skuIndex.has(sku.trim())) {
      return { ok: false, status: 409, error: `SKU "${sku}" already exists` };
    }

    // URL validation
    const imgCheck = this._validateUrlArray(image_urls, "image_urls");
    if (!imgCheck.ok) return { ok: false, status: 400, error: imgCheck.error };

    const vidCheck = this._validateUrlArray(video_urls, "video_urls");
    if (!vidCheck.ok) return { ok: false, status: 400, error: vidCheck.error };

    const id = uuidv4();
    const created_at = new Date().toISOString();
    const thumbnail_url = image_urls.length > 0 ? image_urls[0] : null;

    // Store lean summary (no full URL arrays)
    const summary = {
      id,
      name: name.trim(),
      sku: sku.trim(),
      image_count: image_urls.length,
      video_count: video_urls.length,
      thumbnail_url,
      created_at,
    };

    // Store full media separately
    this.products.set(id, summary);
    this.media.set(id, {
      image_urls: [...image_urls],
      video_urls: [...video_urls],
    });
    this.skuIndex.set(sku.trim(), id);

    // Return full product for 201 response
    return {
      ok: true,
      product: { ...summary, image_urls: [...image_urls], video_urls: [...video_urls] },
    };
  }

  // ─── List products (paginated, lean) ─────────────────────────────────────

  list({ limit = 20, offset = 0 } = {}) {
    const parsedLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const parsedOffset = Math.max(parseInt(offset) || 0, 0);

    const all = Array.from(this.products.values());
    // Sorted newest-first
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const total = all.length;
    const items = all.slice(parsedOffset, parsedOffset + parsedLimit);

    // items are already the lean summary objects — no media Map touched
    return {
      ok: true,
      data: {
        total,
        limit: parsedLimit,
        offset: parsedOffset,
        items,
      },
    };
  }

  // ─── Get single product (full detail) ────────────────────────────────────

  getById(id) {
    const summary = this.products.get(id);
    if (!summary) return { ok: false, status: 404, error: "Product not found" };

    const mediaRecord = this.media.get(id);
    return {
      ok: true,
      product: {
        ...summary,
        image_urls: [...mediaRecord.image_urls],
        video_urls: [...mediaRecord.video_urls],
      },
    };
  }

  // ─── Append media to existing product ────────────────────────────────────

  appendMedia(id, { image_urls = [], video_urls = [] }) {
    const summary = this.products.get(id);
    if (!summary) return { ok: false, status: 404, error: "Product not found" };

    if (image_urls.length === 0 && video_urls.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "At least one of image_urls or video_urls must be provided and non-empty",
      };
    }

    const imgCheck = this._validateUrlArray(image_urls, "image_urls");
    if (!imgCheck.ok) return { ok: false, status: 400, error: imgCheck.error };

    const vidCheck = this._validateUrlArray(video_urls, "video_urls");
    if (!vidCheck.ok) return { ok: false, status: 400, error: vidCheck.error };

    const mediaRecord = this.media.get(id);
    mediaRecord.image_urls.push(...image_urls);
    mediaRecord.video_urls.push(...video_urls);

    // Update lean summary counts (and thumbnail if needed)
    summary.image_count = mediaRecord.image_urls.length;
    summary.video_count = mediaRecord.video_urls.length;
    if (!summary.thumbnail_url && mediaRecord.image_urls.length > 0) {
      summary.thumbnail_url = mediaRecord.image_urls[0];
    }

    return {
      ok: true,
      product: {
        ...summary,
        image_urls: [...mediaRecord.image_urls],
        video_urls: [...mediaRecord.video_urls],
      },
    };
  }
}

module.exports = new ProductStore();
