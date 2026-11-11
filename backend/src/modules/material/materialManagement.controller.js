const fs = require("node:fs/promises");
const mongoose = require("mongoose");
const Material = require("../../models/Material");
const { validateTags, validateFilename } = require("./material.validation");
const { materialPath } = require("./materialStorage");

function ownedQuery(req, res) {
  res.set("Cache-Control", "private, no-store");
  if (!mongoose.isObjectIdOrHexString(req.user.id)) {
    res.status(401).json({ status: "error", message: "Invalid authenticated instructor ID" });
    return null;
  }
  if (!mongoose.isObjectIdOrHexString(req.params.id) || Object.keys(req.query).length) {
    res.status(400).json({ status: "error", message: "Invalid material request" });
    return null;
  }
  return { _id: req.params.id, uploadedBy: req.user.id };
}
function notFound(res) {
  return res.status(404).json({ status: "error", message: "Material not found" });
}

async function updateMaterial(req, res, next) {
  const owner = ownedQuery(req, res);
  if (!owner) return;
  if (!req.is("application/json")) {
    return res.status(415).json({ status: "error", message: "Metadata updates require JSON" });
  }
  const body = req.body;
  const allowed = new Set(["originalFilename", "course", "subject", "topic"]);
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length
    || Object.keys(body).some((field) => !allowed.has(field))) {
    return res.status(400).json({ status: "error", message: "Supply only filename, course, subject or topic" });
  }
  try {
    const query = { ...owner, deletedAt: null };
    const current = await Material.findOne(query);
    if (!current) return notFound(res);
    const { tags, errors } = validateTags(body, true);
    const changes = Object.fromEntries(Object.entries(tags).map(([field, value]) => [`tags.${field}`, value]));
    if (Object.hasOwn(body, "originalFilename")) {
      const error = validateFilename(body.originalFilename, current.fileType);
      if (error) errors.originalFilename = error;
      else changes.originalFilename = body.originalFilename.trim();
    }
    if (Object.keys(errors).length) {
      return res.status(400).json({ status: "error", message: "Study material details are invalid", errors });
    }
    // Only explicit metadata paths are written; concurrent downloads retain their counts.
    const material = await Material.findOneAndUpdate(query, { $set: changes }, { new: true, runValidators: true })
      .select("-storageLocation -storedFilename -__v -deletedAt");
    if (!material) return notFound(res);
    return res.status(200).json({ status: "success", message: "Study material updated", material: material.toJSON() });
  } catch (error) {
    return next(error);
  }
}

async function deleteMaterial(req, res, next) {
  const owner = ownedQuery(req, res);
  if (!owner) return;
  if (req.body && Object.keys(req.body).length) {
    return res.status(400).json({ status: "error", message: "Deletion does not accept additional fields" });
  }
  try {
    const current = await Material.findOne(owner);
    if (!current) return notFound(res);
    const filename = materialPath(current.storedFilename);
    // Keep a durable, hidden record until both filesystem and database cleanup succeed.
    await Material.updateOne({ ...owner, deletedAt: null }, { $set: { deletedAt: new Date() } });
    try {
      // unlink never follows the final symlink and never recursively removes directories.
      await fs.unlink(filename);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await Material.deleteOne({ ...owner, deletedAt: { $ne: null } });
    return res.status(200).json({ status: "success", message: "Study material deleted" });
  } catch (error) {
    // The existing generic handler hides private filenames and database details.
    return next(error);
  }
}

module.exports = { updateMaterial, deleteMaterial };
