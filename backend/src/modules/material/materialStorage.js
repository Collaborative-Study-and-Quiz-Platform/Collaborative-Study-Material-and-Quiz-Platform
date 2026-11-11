const path = require("node:path");

const UPLOAD_DIRECTORY = path.resolve(
  process.env.MATERIAL_UPLOAD_DIR || path.join(__dirname, "../../../uploads/materials")
);

function materialPath(filename) {
  if (typeof filename !== "string" || !filename || filename === "." || filename === ".."
    || filename !== path.basename(filename) || /[\\/\x00]/.test(filename)) {
    throw new Error("Invalid stored material filename");
  }
  return path.join(UPLOAD_DIRECTORY, filename);
}

module.exports = { UPLOAD_DIRECTORY, materialPath };
