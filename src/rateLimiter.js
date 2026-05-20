/**
 * RateLimiter - Fixed 1-minute window, per user_id
 * Thread-safe for Node.js (single-threaded event loop).
 * Max 5 accepted requests per user per window.
 */

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 5;

class RateLimiter {
  constructor() {
    // Map<userId, { windowStart: number, accepted: number, rejected: number }>
    this.users = new Map();
    // Periodic cleanup every 5 minutes to avoid unbounded memory growth
    this._cleanupInterval = setInterval(() => this._cleanup(), 5 * 60 * 1000);
  }

  /**
   * Try to accept a request for a given user.
   * Returns { allowed: boolean }
   */
  consume(userId) {
    const now = Date.now();
    let record = this.users.get(userId);

    if (!record || now - record.windowStart >= WINDOW_MS) {
      // Start a fresh window
      record = { windowStart: now, accepted: 0, rejected: 0 };
      this.users.set(userId, record);
    }

    if (record.accepted < MAX_REQUESTS) {
      record.accepted += 1;
      return { allowed: true };
    } else {
      record.rejected += 1;
      return { allowed: false };
    }
  }

  /**
   * Get stats for all users.
   * Returns array of per-user stat objects.
   */
  getStats() {
    const now = Date.now();
    const stats = [];

    for (const [userId, record] of this.users.entries()) {
      const windowActive = now - record.windowStart < WINDOW_MS;
      stats.push({
        user_id: userId,
        window_start: new Date(record.windowStart).toISOString(),
        window_end: new Date(record.windowStart + WINDOW_MS).toISOString(),
        accepted_in_window: windowActive ? record.accepted : 0,
        // rejected is cumulative across all windows for this user session
        rejected_cumulative: record.rejected,
        window_active: windowActive,
      });
    }

    return stats;
  }

  /** Remove stale records that haven't been touched in 2+ windows */
  _cleanup() {
    const now = Date.now();
    for (const [userId, record] of this.users.entries()) {
      if (now - record.windowStart >= 2 * WINDOW_MS) {
        this.users.delete(userId);
      }
    }
  }

  /** Call on graceful shutdown to avoid dangling timer */
  destroy() {
    clearInterval(this._cleanupInterval);
  }
}

module.exports = new RateLimiter();
