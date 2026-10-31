const mongoose = require("mongoose");
const User = require("../models/User");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createAdminAccount({ name, email, password }) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("ADMIN_NAME is required");
  }
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    throw new Error("ADMIN_EMAIL must be a valid email address");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail }).select("+password");

  if (existingUser) {
    if (existingUser.role !== "admin") {
      throw new Error("An existing non-admin account uses ADMIN_EMAIL");
    }

    return existingUser;
  }

  return User.create({
    name: name.trim(),
    email: normalizedEmail,
    password,
    role: "admin"
  });
}

async function run() {
  const { MONGODB_URI, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from the .env file");
  }

  await mongoose.connect(MONGODB_URI);
  await createAdminAccount({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD
  });
  console.log("Admin account is ready");
}

if (require.main === module) {
  require("dotenv").config();
  run()
    .catch((error) => {
      console.error("Admin account setup failed:", error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = { createAdminAccount };
