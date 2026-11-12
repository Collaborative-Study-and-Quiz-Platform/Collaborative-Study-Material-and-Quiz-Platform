const mongoose = require("mongoose");
const Bookmark = require("../../models/Bookmark");
const Material = require("../../models/Material");
const { ratingSummaries, emptySummary } = require("./materialRating.service");

function validateRequest(req, res) {
  res.set("Cache-Control", "private, no-store");
  if (!mongoose.isObjectIdOrHexString(req.user.id)) {
    res.status(401).json({ status: "error", message: "Invalid authenticated student ID" });
    return false;
  }
  if (req.params.id && !mongoose.isObjectIdOrHexString(req.params.id)) {
    res.status(400).json({ status: "error", message: "Invalid material ID" });
    return false;
  }
  if (Object.keys(req.query).length || (req.body && Object.keys(req.body).length)) {
    res.status(400).json({ status: "error", message: "Bookmark requests do not accept additional fields" });
    return false;
  }
  return true;
}

async function listBookmarks(req, res, next) {
  if (!validateRequest(req, res)) return;
  try {
    const bookmarks = await Bookmark.find({ student: req.user.id })
      .sort({ createdAt: -1, _id: -1 })
      .populate({ path: "material", match: { deletedAt: null }, select: "-storageLocation -storedFilename -__v -deletedAt" })
      .lean();
    const materials = bookmarks.filter(({ material }) => material).map(({ material }) => ({
      ...material, downloadCount: material.downloadCount ?? 0
    }));
    let summaries;
    try {
      summaries = await ratingSummaries(materials.map((material) => material._id), req.user);
    } catch (error) {
      console.error("Unable to load bookmark rating summaries:", error.message);
    }
    return res.status(200).json({ status: "success", count: materials.length,
      materials: materials.map((material) => ({ ...material,
        ratingSummary: summaries ? summaries.get(String(material._id)) || emptySummary() : null })) });
  } catch (error) {
    return next(error);
  }
}

async function saveBookmark(req, res, next) {
  if (!validateRequest(req, res)) return;
  const filter = { student: req.user.id, material: req.params.id };
  try {
    if (!await Material.exists({ _id: req.params.id, deletedAt: null })) {
      return res.status(404).json({ status: "error", message: "Material not found" });
    }
    // Mongoose already initializes models on connection. Await completion here so
    // the unique index also protects the first requests, without changing startup.
    await Bookmark.init();
    try {
      await Bookmark.updateOne(filter, { $setOnInsert: filter }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000 || !error.keyPattern?.student || !error.keyPattern?.material) throw error;
      // A concurrent save won the unique-index race: the desired state exists.
    }
    if (!await Material.exists({ _id: req.params.id, deletedAt: null })) {
      await Bookmark.deleteOne(filter);
      return res.status(404).json({ status: "error", message: "Material not found" });
    }
    return res.status(200).json({ status: "success", materialId: req.params.id, bookmarked: true });
  } catch (error) {
    return next(error);
  }
}

async function removeBookmark(req, res, next) {
  if (!validateRequest(req, res)) return;
  try {
    await Bookmark.deleteOne({ student: req.user.id, material: req.params.id });
    return res.status(200).json({ status: "success", materialId: req.params.id, bookmarked: false });
  } catch (error) {
    return next(error);
  }
}

module.exports = { listBookmarks, saveBookmark, removeBookmark };
