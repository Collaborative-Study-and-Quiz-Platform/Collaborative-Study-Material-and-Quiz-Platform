const path = require("node:path");
const { containsUnsafeContent } = require("../../middleware/sanitizeJsonBody");

function validateTags(body, partial = false) {
  const errors = {};
  const tags = {};

  ["course", "subject", "topic"].forEach((field) => {
    if (partial && !Object.hasOwn(body, field)) return;
    const value = typeof body[field] === "string" ? body[field].trim() : "";
    if (!value) {
      errors[field] = `${field[0].toUpperCase()}${field.slice(1)} is required`;
    } else if (containsUnsafeContent(value)) {
      errors[field] = `${field[0].toUpperCase()}${field.slice(1)} contains unsafe content`;
    } else if (value.length > 100) {
      errors[field] = `${field[0].toUpperCase()}${field.slice(1)} must be 100 characters or fewer`;
    } else {
      tags[field] = value;
    }
  });

  return { tags, errors };
}

function validateFilename(value, fileType) {
  if (typeof value !== "string") return "Filename must be text";
  const filename = value.trim();
  if (!filename || filename.length > 255 || /[\\/\x00-\x1f\x7f]/.test(filename)
    || containsUnsafeContent(filename) || path.extname(filename).toLowerCase() !== `.${fileType}`) {
    return "Use a filename of 1–255 characters without paths or control characters, keeping the original extension";
  }
  return null;
}

module.exports = { validateTags, validateFilename };
