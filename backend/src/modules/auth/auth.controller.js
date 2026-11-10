const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../../models/User");
const RefreshToken = require("../../models/RefreshToken");
const { getJwtConfig, durationInSeconds } = require("../../config/auth");
const { createNotification } = require("../notification/notification.service");

const ALLOWED_ROLES = new Set(["student", "instructor"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFRESH_TOKEN_PATTERN = /^[a-f0-9]{96}$/;

function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createAccessToken(user) {
  const { secret, expiresIn } = getJwtConfig();
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    secret,
    { expiresIn, algorithm: "HS256" }
  );
}

async function createRefreshToken(userId, familyId = crypto.randomUUID()) {
  const { refreshExpiresIn } = getJwtConfig();
  const token = crypto.randomBytes(48).toString("hex");
  await RefreshToken.create({
    userId,
    tokenHash: hashRefreshToken(token),
    familyId,
    expiresAt: new Date(Date.now() + durationInSeconds(refreshExpiresIn, "JWT_REFRESH_EXPIRES_IN") * 1000)
  });
  return token;
}

function validateRegistrationInput(body) {
  const { name, email, password, role } = body;
  const errors = {};

  if (typeof name !== "string" || !name.trim()) {
    errors.name = "Name is required";
  } else if (name.trim().length > 100) {
    errors.name = "Name must be 100 characters or fewer";
  }
  if (typeof email !== "string" || !email.trim()) {
    errors.email = "Email is required";
  } else if (!EMAIL_PATTERN.test(email.trim()) || email.trim().length > 254) {
    errors.email = "Email must be a valid email address";
  }
  if (typeof password !== "string" || !password) {
    errors.password = "Password is required";
  } else if (password.length < 8 || password.length > 72) {
    errors.password = "Password must be between 8 and 72 characters";
  }
  if (typeof role !== "string" || !role.trim()) {
    errors.role = "Role is required";
  } else if (!ALLOWED_ROLES.has(role.trim().toLowerCase())) {
    errors.role = "Role must be student or instructor";
  }
  return errors;
}

async function register(req, res, next) {
  const errors = validateRegistrationInput(req.body || {});
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      status: "error",
      message: "Registration details are invalid",
      errors
    });
  }

  const { name, email, password, role } = req.body;
  try {
    const user = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      role: role.trim().toLowerCase()
    });
    await createNotification({
      userId: user._id,
      type: "welcome",
      title: "Welcome to CSQP",
      message: "Your account has been created successfully."
    });

    return res.status(201).json({
      status: "success",
      message: "Registration successful",
      user: user.toJSON()
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({
        status: "error",
        message: "An account with this email already exists"
      });
    }
    return next(error);
  }
}

function validateLoginInput(body) {
  const { email, password } = body;
  const errors = {};
  if (typeof email !== "string" || !email.trim()) {
    errors.email = "Email is required";
  } else if (!EMAIL_PATTERN.test(email.trim()) || email.trim().length > 254) {
    errors.email = "Email must be a valid email address";
  }
  if (typeof password !== "string" || !password) {
    errors.password = "Password is required";
  } else if (password.length > 72) {
    errors.password = "Password must be 72 characters or fewer";
  }
  return errors;
}

async function login(req, res, next) {
  const errors = validateLoginInput(req.body || {});
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      status: "error",
      message: "Login details are invalid",
      errors
    });
  }

  const { email, password } = req.body;
  try {
    const user = await User.findOne({
      email: email.trim().toLowerCase()
    }).select("+password");
    const passwordMatches = user ? await bcrypt.compare(password, user.password) : false;
    if (!user || !passwordMatches) {
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password"
      });
    }

    const accessToken = createAccessToken(user);
    const refreshToken = await createRefreshToken(user._id);
    return res.status(200).json({
      status: "success",
      message: "Login successful",
      token: accessToken,
      accessToken,
      refreshToken,
      user: user.toJSON()
    });
  } catch (error) {
    return next(error);
  }
}

async function refreshSession(req, res, next) {
  const { refreshToken } = req.body || {};
  if (typeof refreshToken !== "string" || !REFRESH_TOKEN_PATTERN.test(refreshToken)) {
    return res.status(401).json({
      status: "error",
      message: "Invalid or expired refresh token"
    });
  }

  try {
    const existing = await RefreshToken.findOne({
      tokenHash: hashRefreshToken(refreshToken)
    });
    if (!existing || existing.expiresAt <= new Date() || existing.revokedAt) {
      return res.status(401).json({
        status: "error",
        message: "Invalid or expired refresh token"
      });
    }
    if (existing.usedAt) {
      await RefreshToken.updateMany(
        { familyId: existing.familyId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      return res.status(401).json({
        status: "error",
        message: "Refresh token reuse detected; sign in again"
      });
    }

    const claimed = await RefreshToken.findOneAndUpdate(
      {
        _id: existing._id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() }
      },
      { $set: { usedAt: new Date() } },
      { new: true }
    );
    if (!claimed) {
      const current = await RefreshToken.findById(existing._id);
      if (current && current.usedAt) {
        await RefreshToken.updateMany(
          { familyId: existing.familyId, revokedAt: null },
          { $set: { revokedAt: new Date() } }
        );
      }
      return res.status(401).json({
        status: "error",
        message: "Invalid or expired refresh token"
      });
    }

    const user = await User.findById(claimed.userId);
    if (!user) {
      await RefreshToken.updateMany(
        { familyId: claimed.familyId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      return res.status(401).json({
        status: "error",
        message: "The account associated with this session no longer exists"
      });
    }

    const nextRefreshToken = await createRefreshToken(user._id, claimed.familyId);
    const accessToken = createAccessToken(user);
    return res.status(200).json({
      status: "success",
      token: accessToken,
      accessToken,
      refreshToken: nextRefreshToken
    });
  } catch (error) {
    return next(error);
  }
}

async function logout(req, res, next) {
  const { refreshToken } = req.body || {};
  if (typeof refreshToken !== "string" || !REFRESH_TOKEN_PATTERN.test(refreshToken)) {
    return res.status(400).json({
      status: "error",
      message: "A valid refresh token is required"
    });
  }
  try {
    const token = await RefreshToken.findOne({ tokenHash: hashRefreshToken(refreshToken) });
    if (token) {
      await RefreshToken.updateMany(
        { familyId: token.familyId, userId: token.userId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }
    return res.status(200).json({ status: "success", message: "Logged out" });
  } catch (error) {
    return next(error);
  }
}

async function getCurrentUser(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "User account not found"
      });
    }
    return res.status(200).json({
      status: "success",
      user: user.toJSON()
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  login,
  register,
  getCurrentUser,
  refreshSession,
  logout,
  validateLoginInput,
  validateRegistrationInput
};
