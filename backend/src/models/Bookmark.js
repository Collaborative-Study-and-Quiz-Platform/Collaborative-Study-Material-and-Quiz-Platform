const mongoose = require("mongoose");

const bookmarkSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  material: { type: mongoose.Schema.Types.ObjectId, ref: "Material", required: true }
}, { timestamps: true });

bookmarkSchema.index({ student: 1, material: 1 }, { unique: true });

module.exports = mongoose.model("Bookmark", bookmarkSchema);
