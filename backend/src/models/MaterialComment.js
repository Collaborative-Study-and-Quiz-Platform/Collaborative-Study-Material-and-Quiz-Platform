const mongoose = require("mongoose");

const materialCommentSchema = new mongoose.Schema({
  material: { type: mongoose.Schema.Types.ObjectId, ref: "Material", required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  content: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 }
}, { timestamps: true });

materialCommentSchema.index({ material: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("MaterialComment", materialCommentSchema);
