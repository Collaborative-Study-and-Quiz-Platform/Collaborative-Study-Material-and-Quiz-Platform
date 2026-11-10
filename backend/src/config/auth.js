function getJwtConfig() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from the .env file");
  }

  return {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "1h"
  };
}

module.exports = { getJwtConfig };
function durationInSeconds(value, name) {
  const match = /^([1-9]\d*)(s|m|h|d)$/.exec(value);
  if (!match) {
    throw new Error(`${name} must use a duration such as 15m`);
  }

  const units = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = Number(match[1]) * units[match[2]];
  if (!Number.isSafeInteger(seconds)) {
    throw new Error(`${name} is outside the supported range`);
  }
  return seconds;
}

function getJwtConfig() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is missing from the .env file");
  }
  if (process.env.NODE_ENV === "production" && Buffer.byteLength(secret) < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes in production");
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || "15m";
  if (durationInSeconds(expiresIn, "JWT_EXPIRES_IN") > 3600) {
    throw new Error("JWT_EXPIRES_IN cannot exceed 1h");
  }

  const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || "7d";
  if (durationInSeconds(refreshExpiresIn, "JWT_REFRESH_EXPIRES_IN") > 30 * 86400) {
    throw new Error("JWT_REFRESH_EXPIRES_IN cannot exceed 30d");
  }

  return { secret, expiresIn, refreshExpiresIn };
}

module.exports = { getJwtConfig, durationInSeconds };
