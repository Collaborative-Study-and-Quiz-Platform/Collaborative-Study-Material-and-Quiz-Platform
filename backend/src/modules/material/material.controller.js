const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const Material = require("../../models/Material");

const configuredMaxFileSize = Number.parseInt(
  process.env.MATERIAL_MAX_FILE_SIZE_BYTES || "",
  10
);
const MAX_FILE_SIZE = Number.isSafeInteger(configuredMaxFileSize) && configuredMaxFileSize > 0
  ? configuredMaxFileSize
  : 10 * 1024 * 1024;
const UPLOAD_DIRECTORY = path.resolve(
  process.env.MATERIAL_UPLOAD_DIR || path.join(__dirname, "../../../uploads/materials")
);
const SUPPORTED_TYPES = {
  pdf: { mimeTypes: new Set(["application/pdf"]) },
  docx: {
    mimeTypes: new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip"
    ])
  },
  ppt: {
    mimeTypes: new Set([
      "application/vnd.ms-powerpoint",
      "application/octet-stream"
    ])
  }
};

function getFileType(filename) {
  const extension = path.extname(filename || "").toLowerCase().slice(1);
  return Object.hasOwn(SUPPORTED_TYPES, extension) ? extension : null;
}

function hasValidSignature(fileType, buffer) {
  if (fileType === "pdf") {
    return buffer.subarray(0, 5).toString() === "%PDF-";
  }

  if (fileType === "docx") {
    return buffer.subarray(0, 2).toString("hex") === "504b"
      && buffer.includes(Buffer.from("[Content_Types].xml"));
  }

  return buffer.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1";
}

function validateTags(body) {
  const errors = {};
  const tags = {};

  ["course", "subject", "topic"].forEach((field) => {
    const value = typeof body[field] === "string" ? body[field].trim() : "";
    if (!value) {
      errors[field] = `${field[0].toUpperCase()}${field.slice(1)} is required`;
    } else if (value.length > 100) {
      errors[field] = `${field[0].toUpperCase()}${field.slice(1)} must be 100 characters or fewer`;
    } else {
      tags[field] = value;
    }
  });

  return { tags, errors };
}

async function createMaterial(req, res, next) {
  if (!req.file) {
    return res.status(400).json({
      status: "error",
      message: "A study material file is required"
    });
  }

  const fileType = getFileType(req.file.originalname);
  const { tags, errors } = validateTags(req.body || {});
  if (!fileType || !SUPPORTED_TYPES[fileType].mimeTypes.has(req.file.mimetype)) {
    errors.file = "Only PDF, DOCX, and PPT files are supported";
  } else if (!hasValidSignature(fileType, req.file.buffer)) {
    errors.file = "The uploaded file does not match its declared type";
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      status: "error",
      message: "Study material details are invalid",
      errors
    });
  }

  const storedFilename = `${crypto.randomUUID()}.${fileType}`;
  const storageLocation = path.join(UPLOAD_DIRECTORY, storedFilename);

  try {
    await fs.mkdir(UPLOAD_DIRECTORY, { recursive: true });
    await fs.writeFile(storageLocation, req.file.buffer, { flag: "wx" });

    let material;
    try {
      material = await Material.create({
        originalFilename: req.file.originalname,
        storedFilename,
        fileType,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        tags,
        uploadedBy: req.user.id,
        storageLocation
      });
    } catch (error) {
      try {
        await fs.unlink(storageLocation);
      } catch (cleanupError) {
        console.error("Failed to clean up uploaded material:", cleanupError.message);
      }
      throw error;
    }

    return res.status(201).json({
      status: "success",
      message: "Study material uploaded",
      material: material.toJSON()
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createMaterial,
  MAX_FILE_SIZE,
  SUPPORTED_TYPES
};
