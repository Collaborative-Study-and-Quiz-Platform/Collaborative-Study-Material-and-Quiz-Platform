const mongoose = require("mongoose");
const Material = require("../../models/Material");
const MaterialComment = require("../../models/MaterialComment");
const User = require("../../models/User");
const { containsUnsafeContent } = require("../../middleware/sanitizeJsonBody");

const isId = (value) => typeof value === "string" && mongoose.isObjectIdOrHexString(value);

function publicComment(comment) {
  return {
    _id: comment._id,
    material: comment.material,
    author: { _id: comment.author?._id ?? null, name: comment.author?.name || "Former user" },
    content: comment.content,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt
  };
}

async function canAccessMaterial(req, res) {
  if (!isId(req.user.id)) {
    res.status(401).json({ status: "error", message: "Invalid authenticated user ID" });
    return false;
  }
  if (!isId(req.params.id)) {
    res.status(400).json({ status: "error", message: "Invalid material ID" });
    return false;
  }
  // Missing legacy markers match null; F-014 can add its schema field independently.
  const query = { _id: req.params.id, deletedAt: null };
  if (req.user.role === "instructor") query.uploadedBy = req.user.id;
  if (!await Material.exists(query)) {
    res.status(404).json({ status: "error", message: "Material not found" });
    return false;
  }
  return true;
}

function parsePagination(query) {
  if (Object.keys(query).some((key) => key !== "limit" && key !== "cursor")) return null;
  const limit = query.limit === undefined ? 20
    : typeof query.limit === "string" && /^\d{1,2}$/.test(query.limit) ? Number(query.limit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return null;
  let cursor;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string" || query.cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) return null;
    try {
      const bytes = Buffer.from(query.cursor, "base64url");
      if (bytes.toString("base64url") !== query.cursor) return null;
      cursor = JSON.parse(bytes.toString("utf8"));
      if (!cursor || Array.isArray(cursor) || Object.keys(cursor).sort().join(",") !== "createdAt,id"
        || !isId(cursor.id) || typeof cursor.createdAt !== "string") return null;
      const date = new Date(cursor.createdAt);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== cursor.createdAt) return null;
      cursor = { id: cursor.id, createdAt: date };
    } catch {
      return null;
    }
  }
  return { limit, cursor };
}

async function listComments(req, res, next) {
  const pagination = parsePagination(req.query);
  if (!pagination || (req.body && Object.keys(req.body).length)) {
    return res.status(400).json({ status: "error", message: "Invalid comment pagination" });
  }
  try {
    if (!await canAccessMaterial(req, res)) return;
    const { limit, cursor } = pagination;
    const query = { material: req.params.id };
    if (cursor) query.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }
    ];
    const results = await MaterialComment.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit + 1)
      .select("_id material author content createdAt updatedAt")
      .populate({ path: "author", select: "_id name" }).lean();
    const hasMore = results.length > limit;
    const comments = results.slice(0, limit);
    const last = comments.at(-1);
    const nextCursor = hasMore ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: String(last._id) })).toString("base64url") : null;
    return res.status(200).json({ status: "success", comments: comments.map(publicComment), hasMore, nextCursor });
  } catch (error) {
    return next(error);
  }
}

async function createComment(req, res, next) {
  if (!req.is("application/json")) {
    return res.status(415).json({ status: "error", message: "Comments require JSON" });
  }
  const body = req.body;
  if (Object.keys(req.query).length || !body || Array.isArray(body) || typeof body !== "object"
    || Object.keys(body).length !== 1 || !Object.hasOwn(body, "content") || typeof body.content !== "string") {
    return res.status(400).json({ status: "error", message: "Supply only comment content as text" });
  }
  const content = body.content.trim();
  if (!content || content.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content) || containsUnsafeContent(content)) {
    return res.status(400).json({ status: "error", message: "Comment must contain 1–2000 safe text characters" });
  }
  // Coarse whole-word English filter only; plain-text rendering provides XSS safety.
  if (/\b(fuck|shit|bitch)\b/i.test(content)) {
    return res.status(400).json({ status: "error", message: "Please remove profanity from your comment" });
  }
  try {
    if (!await canAccessMaterial(req, res)) return;
    const author = await User.findById(req.user.id).select("_id name").lean();
    if (!author) return res.status(401).json({ status: "error", message: "Author account is no longer available" });
    const comment = await MaterialComment.create({ material: req.params.id, author: req.user.id, content });
    return res.status(201).json({ status: "success", message: "Comment posted", comment: publicComment({ ...comment.toObject(), author }) });
  } catch (error) {
    return next(error);
  }
}

module.exports = { createComment, listComments };
