const mongoose = require("mongoose");
const MaterialRating = require("../../models/MaterialRating");

const emptySummary = () => ({ averageRating: null, ratingCount: 0, myRating: null });

async function ratingSummaries(materialIds, user) {
  if (!materialIds.length) return new Map();
  const student = user.role === "student" && mongoose.isObjectIdOrHexString(user.id)
    ? new mongoose.Types.ObjectId(user.id) : null;
  // Aggregation does not apply Mongoose query casting. Return summaries, never ballots.
  const rows = await MaterialRating.aggregate([
    { $match: { material: { $in: materialIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $group: {
      _id: "$material",
      averageRating: { $avg: "$rating" },
      ratingCount: { $sum: 1 },
      myRating: { $max: { $cond: [{ $eq: ["$student", student] }, "$rating", null] } }
    } }
  ]);
  return new Map(rows.map((row) => [String(row._id), {
    averageRating: row.averageRating, ratingCount: row.ratingCount, myRating: student ? row.myRating : null
  }]));
}

async function ratingSummary(materialId, user) {
  const key = new mongoose.Types.ObjectId(materialId).toHexString();
  return (await ratingSummaries([materialId], user)).get(key) || emptySummary();
}

module.exports = { ratingSummaries, ratingSummary, emptySummary };
