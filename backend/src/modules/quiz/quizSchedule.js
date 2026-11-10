// Quiz scheduling rules (CSQP-F-021). A quiz is open to students only
// between availableFrom and availableUntil; a quiz with no schedule is
// treated as a draft and stays hidden from students.

const SCHEDULE_STATUSES = ["unscheduled", "upcoming", "open", "closed"];

function parseDate(value) {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Validates { availableFrom, availableUntil }. Both null (or both left out)
// means "no schedule". Returns { errors, schedule }.
function validateSchedule(body, { durationMinutes, now = new Date() } = {}) {
  const errors = {};
  const fromGiven = body.availableFrom !== undefined && body.availableFrom !== null && body.availableFrom !== "";
  const untilGiven = body.availableUntil !== undefined && body.availableUntil !== null && body.availableUntil !== "";

  if (!fromGiven && !untilGiven) {
    return { errors, schedule: { availableFrom: null, availableUntil: null } };
  }

  if (fromGiven !== untilGiven) {
    errors[fromGiven ? "availableUntil" : "availableFrom"] = "Give both a start and an end time, or neither";
    return { errors, schedule: null };
  }

  const availableFrom = parseDate(body.availableFrom);
  const availableUntil = parseDate(body.availableUntil);

  if (!availableFrom) {
    errors.availableFrom = "Start time must be a valid date and time";
  }
  if (!availableUntil) {
    errors.availableUntil = "End time must be a valid date and time";
  }
  if (availableFrom && availableUntil) {
    if (availableUntil <= availableFrom) {
      errors.availableUntil = "End time must be after the start time";
    } else if (availableUntil <= now) {
      errors.availableUntil = "End time must be in the future";
    } else if (
      Number.isFinite(durationMinutes)
      && availableUntil - availableFrom < durationMinutes * 60 * 1000
    ) {
      errors.availableUntil = "The window must be at least as long as the quiz duration";
    }
  }

  return {
    errors,
    schedule: Object.keys(errors).length ? null : { availableFrom, availableUntil }
  };
}

function scheduleStatus(quiz, now = new Date()) {
  if (!quiz.availableFrom || !quiz.availableUntil) {
    return "unscheduled";
  }
  if (now < quiz.availableFrom) {
    return "upcoming";
  }
  if (now >= quiz.availableUntil) {
    return "closed";
  }
  return "open";
}

// Why a quiz cannot be started right now, or null if it can
function startBlockedMessage(quiz, now = new Date()) {
  const status = scheduleStatus(quiz, now);
  if (status === "unscheduled") {
    return "This quiz has not been scheduled yet";
  }
  if (status === "upcoming") {
    return `This quiz opens at ${quiz.availableFrom.toISOString()}`;
  }
  if (status === "closed") {
    return `This quiz closed at ${quiz.availableUntil.toISOString()}`;
  }
  return null;
}

// An attempt never runs past the end of the quiz window
function attemptDeadline(quiz, startedAt) {
  const timerEnd = new Date(startedAt.getTime() + quiz.durationMinutes * 60 * 1000);
  return quiz.availableUntil && quiz.availableUntil < timerEnd ? new Date(quiz.availableUntil) : timerEnd;
}

module.exports = {
  SCHEDULE_STATUSES,
  validateSchedule,
  scheduleStatus,
  startBlockedMessage,
  attemptDeadline
};
