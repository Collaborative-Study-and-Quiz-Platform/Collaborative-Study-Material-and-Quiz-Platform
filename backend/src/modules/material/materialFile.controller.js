const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { materialPath } = require("./materialStorage");
const mongoose = require("mongoose");
const Material = require("../../models/Material");

const contentTypes = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint"
};

async function serveMaterial(req, res, download) {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    return res.status(400).json({ status: "error", message: "Invalid material ID" });
  }
  let handle;
  try {
    const query = { _id: req.params.id, deletedAt: null };
    if (req.user.role === "instructor") query.uploadedBy = req.user.id;
    const material = await Material.findOne(query);
    if (!material) return res.status(404).json({ status: "error", message: "Material not found" });
    // Derive access from a single stored basename, never a client path or storageLocation.
    const filename = material.storedFilename;
    if (!filename || filename === "." || filename === ".." || filename !== path.basename(filename) || /[\\/\x00]/.test(filename)
      || !Object.hasOwn(contentTypes, material.fileType)) {
      return res.status(404).json({ status: "error", message: "Material file unavailable" });
    }
    handle = await fs.open(materialPath(filename), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0) {
      await handle.close();
      handle = null;
      return res.status(404).json({ status: "error", message: "Material file unavailable" });
    }
    const stream = handle.createReadStream({ start: 0, end: stat.size - 1 });
    handle = null; // The stream owns and closes the descriptor, including on abort.
    res.setHeader("Content-Type", contentTypes[material.fileType]);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const safeName = path.basename(material.originalFilename.replace(/\\/g, "/")).replace(/[\r\n\x00]/g, "");
    // Express's attachment helper handles quoted and Unicode filenames safely.
    res.attachment(safeName);
    if (!download) res.setHeader("Content-Disposition", res.getHeader("Content-Disposition").replace(/^attachment/, "inline"));
    // attachment() infers a MIME type from the name; restore the validated type.
    res.setHeader("Content-Type", contentTypes[material.fileType]);
    let failed = false;
    let bytesRead = 0;
    stream.on("data", (chunk) => { bytesRead += chunk.length; });
    stream.once("error", () => {
      failed = true;
      res.destroy();
    });
    res.once("close", () => stream.destroy());
    res.once("finish", () => {
      if (download && req.method === "GET" && !failed && !req.aborted && res.writableFinished && bytesRead === stat.size) {
        // Exactly one atomic increment per completed response; no read/modify/write race.
        Material.updateOne({ _id: material._id }, { $inc: { downloadCount: 1 } })
          .catch(() => console.error("Failed to record completed material download"));
      }
    });
    if (req.aborted || res.destroyed) return stream.destroy();
    stream.pipe(res);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (res.headersSent) return res.destroy();
    const missing = ["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code);
    return res.status(missing ? 404 : 500).json({
      status: "error",
      message: missing ? "Material file unavailable" : "Unable to retrieve material"
    });
  }
}

module.exports = {
  viewMaterial: (req, res) => serveMaterial(req, res, false),
  downloadMaterial: (req, res) => serveMaterial(req, res, true)
};
