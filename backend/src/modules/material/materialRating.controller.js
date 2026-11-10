const mongoose = require("mongoose");
const Material = require("../../models/Material");
const MaterialRating = require("../../models/MaterialRating");
const User = require("../../models/User");
const { ratingSummary } = require("./materialRating.service");

async function visibleMaterial(req, res) {
  if (!mongoose.isObjectIdOrHexString(req.user.id)) {
    res.status(401).json({ status: "error", message: "Invalid authenticated user ID" });
    return false;
  }
  if (!mongoose.isObjectIdOrHexString(req.params.id) || Object.keys(req.query).length) {
    res.status(400).json({ status: "error", message: "Invalid material rating request" });
    return false;
  }
  const query = { _id: req.params.id, deletedAt: null };
  if (req.user.role === "instructor") query.uploadedBy = req.user.id;
  if (!await Material.exists(query)) {
    res.status(404).json({ status: "error", message: "Material not found" });
    return false;
  }
  return true;
}

async function getRating(req, res, next) {
  if (req.body && Object.keys(req.body).length) {
    return res.status(400).json({ status: "error", message: "Rating reads do not accept a body" });
  }
  try {
    if (!await visibleMaterial(req, res)) return;
    return res.status(200).json({ status: "success", materialId: req.params.id, ...await ratingSummary(req.params.id, req.user) });
  } catch (error) { return next(error); }
}

async function putRating(req, res, next) {
  if (!req.is("application/json")) {
    return res.status(415).json({ status: "error", message: "Ratings require JSON" });
  }
  const body = req.body;
  if (!body || Array.isArray(body) || typeof body !== "object" || Object.keys(body).length !== 1
    || !Object.hasOwn(body, "rating") || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
    return res.status(400).json({ status: "error", message: "Supply only an integer rating from 1 to 5" });
  }
  try {
    if (!await visibleMaterial(req, res)) return;
    if (!await User.exists({ _id: req.user.id })) {
      return res.status(401).json({ status: "error", message: "Student account is no longer available" });
    }
    // Await the unique index before first writes, retaining existing startup conventions.
    await MaterialRating.init();
    const filter = { material: req.params.id, student: req.user.id };
    try {
      await MaterialRating.updateOne(filter, { $set: { rating: body.rating } }, { upsert: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000 || !error.keyPattern?.material || !error.keyPattern?.student) throw error;
      // A concurrent first writer may have saved a different value. Apply this vote,
      // rather than reporting success without updating the winning document.
      const result = await MaterialRating.updateOne(filter, { $set: { rating: body.rating } }, { runValidators: true });
      if (!result.matchedCount) throw new Error("Concurrent rating is no longer available; retry the rating");
    }
    // A deletion can race the write. Do not return a success for a known missing parent.
    if (!await visibleMaterial(req, res)) return;
    return res.status(200).json({ status: "success", materialId: req.params.id, ...await ratingSummary(req.params.id, req.user) });
  } catch (error) { return next(error); }
}

module.exports = { getRating, putRating };
