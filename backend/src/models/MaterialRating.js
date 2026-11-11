const mongoose = require("mongoose");

const materialRatingSchema = new mongoose.Schema({
  material: { type: mongoose.Schema.Types.ObjectId, ref: "Material", required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  rating: { type: Number, required: true, enum: [1, 2, 3, 4, 5] }
}, { timestamps: true });

materialRatingSchema.index({ material: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("MaterialRating", materialRatingSchema);
