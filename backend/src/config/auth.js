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
