// Duplicate question detection (CSQP-F-033): a basic string-similarity check.
// Texts are compared after lower-casing and removing punctuation and extra
// spaces, using the Sorensen-Dice coefficient over character pairs (bigrams).
const Question = require("../../models/Question");

const DUPLICATE_THRESHOLD = 0.85;
const MAX_MATCHES = 5;

function normalizeForComparison(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(text) {
  const counts = new Map();
  for (let i = 0; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }
  return counts;
}

// Returns a score from 0 (nothing in common) to 1 (same text)
function similarity(first, second) {
  const a = normalizeForComparison(first);
  const b = normalizeForComparison(second);

  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a.length < 2 || b.length < 2) {
    return 0;
  }

  const pairsA = bigrams(a);
  const pairsB = bigrams(b);
  let shared = 0;
  pairsA.forEach((count, pair) => {
    shared += Math.min(count, pairsB.get(pair) || 0);
  });

  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

// Finds bank questions whose text is near-identical to `text`, most similar first
async function findDuplicates(text, { excludeId } = {}) {
  if (!normalizeForComparison(text)) {
    return [];
  }

  const filter = { isDeleted: false };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  const candidates = await Question.find(filter).select("text type subject topic difficulty createdBy");

  return candidates
    .map((question) => ({ question, score: similarity(text, question.text) }))
    .filter((match) => match.score >= DUPLICATE_THRESHOLD)
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_MATCHES)
    .map(({ question, score }) => ({
      _id: question._id,
      text: question.text,
      type: question.type,
      subject: question.subject,
      topic: question.topic,
      difficulty: question.difficulty,
      similarity: Math.round(score * 100)
    }));
}

module.exports = {
  DUPLICATE_THRESHOLD,
  findDuplicates,
  normalizeForComparison,
  similarity
};
