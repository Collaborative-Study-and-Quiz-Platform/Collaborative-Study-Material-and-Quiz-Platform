const INVALID_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ACTIVE_CONTENT = /<\s*\/?\s*(script|iframe|object|embed|svg|math)\b|\bon[a-z]+\s*=|javascript\s*:/i;

function containsUnsafeKey(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(([key, child]) =>
    INVALID_KEYS.has(key) || key.includes("$") || key.includes(".")
      || containsUnsafeKey(child)
  );
}

function containsUnsafeContent(value) {
  if (typeof value === "string") {
    return ACTIVE_CONTENT.test(value);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.values(value).some(containsUnsafeContent);
}

function containsUnsafeInput(value) {
  return containsUnsafeKey(value) || containsUnsafeContent(value);
}

function sanitizeJsonBody(req, res, next) {
  if (containsUnsafeKey(req.body) || containsUnsafeKey(req.query)) {
    return res.status(400).json({
      status: "error",
      message: "Request contains an invalid field name"
    });
  }
  if (containsUnsafeContent(req.body) || containsUnsafeContent(req.query)) {
    return res.status(400).json({
      status: "error",
      message: "Request contains unsafe content"
    });
  }
  return next();
}

module.exports = {
  sanitizeJsonBody,
  containsUnsafeInput,
  containsUnsafeKey,
  containsUnsafeContent
};
