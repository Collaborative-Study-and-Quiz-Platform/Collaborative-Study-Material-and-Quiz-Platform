function createRateLimiter({ windowMs, max, message }) {
  if (!Number.isInteger(windowMs) || windowMs < 1000
    || !Number.isInteger(max) || max < 1) {
    throw new Error("Rate limiter window and request limit must be positive integers");
  }

  const clients = new Map();
  let requestsSinceCleanup = 0;

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let client = clients.get(key);
    if (!client || now >= client.resetAt) {
      client = { count: 0, resetAt: now + windowMs };
      clients.set(key, client);
    }
    client.count += 1;
    requestsSinceCleanup += 1;

    if (requestsSinceCleanup >= 256 || clients.size > 10000) {
      for (const [clientKey, entry] of clients) {
        if (now >= entry.resetAt) clients.delete(clientKey);
      }
      requestsSinceCleanup = 0;
    }

    const remaining = Math.max(0, max - client.count);
    res.set("RateLimit-Policy", `${max};w=${Math.ceil(windowMs / 1000)}`);
    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(remaining));
    res.set("RateLimit-Reset", String(Math.max(0, Math.ceil((client.resetAt - now) / 1000))));

    if (client.count > max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((client.resetAt - now) / 1000))));
      return res.status(429).json({
        status: "error",
        message: message || "Too many requests. Please try again later."
      });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
