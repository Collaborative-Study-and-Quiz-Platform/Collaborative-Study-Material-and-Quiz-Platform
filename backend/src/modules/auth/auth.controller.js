
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../../models/User");
const { getJwtConfig } = require("../../config/auth");

const ALLOWED_ROLES = new Set(["student", "instructor"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  } else if (!EMAIL_PATTERN.test(email.trim())) {
    errors.email = "Email must be a valid email address";
  }

  if (typeof password !== "string" || !password) {
    errors.password = "Password is required";
  } else if (password.length < 8) {
    errors.password = "Password must be at least 8 characters";
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
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedRole = role.trim().toLowerCase();

  try {
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: normalizedRole
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
  } else if (!EMAIL_PATTERN.test(email.trim())) {
    errors.email = "Email must be a valid email address";
  }

  if (typeof password !== "string" || !password) {
    errors.password = "Password is required";
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

    const passwordMatches = user
      ? await bcrypt.compare(password, user.password)
      : false;

    if (!user || !passwordMatches) {
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password"
      });
    }

    const { secret, expiresIn } = getJwtConfig();

    const token = jwt.sign(
      {
        sub: user._id.toString(),
        role: user.role
      },
      secret,
      { expiresIn }
    );

    return res.status(200).json({
      status: "success",
      message: "Login successful",
      token,
      user: user.toJSON()
    });
  } catch (error) {
    return next(error);
  }
}

// Get the currently authenticated user's details
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
  validateLoginInput,
  validateRegistrationInput
};
