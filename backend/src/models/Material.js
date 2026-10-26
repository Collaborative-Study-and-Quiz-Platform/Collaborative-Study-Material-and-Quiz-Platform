const mongoose = require("mongoose");

const materialSchema = new mongoose.Schema(
  {
    originalFilename: {
      type: String,
      required: true,
      maxlength: 255
    },
    storedFilename: {
      type: String,
      required: true,
      unique: true
    },
    fileType: {
      type: String,
      enum: ["pdf", "docx", "ppt"],
      required: true
    },
    mimeType: {
      type: String,
      required: true
    },
    fileSize: {
      type: Number,
      required: true,
      min: 1
    },
    tags: {
      course: { type: String, required: true, maxlength: 100, trim: true },
      subject: { type: String, required: true, maxlength: 100, trim: true },
      topic: { type: String, required: true, maxlength: 100, trim: true }
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User"
    },
    storageLocation: {
      type: String,
      required: true
    }
  },
  { timestamps: true }
);

materialSchema.set("toJSON", {
  transform: (document, returnedMaterial) => {
    delete returnedMaterial.storageLocation;
    delete returnedMaterial.__v;
  }
});

module.exports = mongoose.model("Material", materialSchema);
