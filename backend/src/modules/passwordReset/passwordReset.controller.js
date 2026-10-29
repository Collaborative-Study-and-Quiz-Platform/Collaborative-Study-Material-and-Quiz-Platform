
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");

const User = require("../../models/User");
const PasswordResetToken = require("../../models/PasswordResetToken");

const TOKEN_EXPIRY_MINUTES = 30;

async function sendResetEmail(email, resetUrl) {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    throw new Error("SMTP configuration is missing");
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === "true",
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: "Password reset request",
    text: `Use this link to reset your password within 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`
  });
}

async function forgotPassword(req, res) {
  try {
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    // Use the same response whether the account exists or not.
    const genericMessage =
      "If an account exists for this email, password reset instructions will be sent.";

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(200).json({ message: genericMessage });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    await PasswordResetToken.deleteMany({ userId: user._id });

    await PasswordResetToken.create({
      userId: user._id,
      tokenHash,
      expiresAt: new Date(
        Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000
      )
    });

    const frontendUrl = process.env.FRONTEND_URL;

    if (!frontendUrl) {
      throw new Error("FRONTEND_URL is missing");
    }

    const resetUrl = `${frontendUrl.replace(/\/$/, "")}/reset-password?token=${rawToken}`;

    await sendResetEmail(user.email, resetUrl);

    return res.status(200).json({ message: genericMessage });
  } catch (error) {
    console.error("Forgot password error:", error.message);
    return res.status(500).json({
      message: "Unable to process the password reset request."
    });
  }
}

async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body || {};

    if (
      typeof token !== "string" ||
      !token ||
      typeof newPassword !== "string" ||
      newPassword.length < 8
    ) {
      return res.status(400).json({
        message: "A valid token and a password of at least 8 characters are required."
      });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const resetRecord = await PasswordResetToken.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() }
    });

    if (!resetRecord) {
      return res.status(400).json({
        message: "The reset link is invalid, expired, or already used."
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Recheck validity immediately before updating the password.
    const claimedToken = await PasswordResetToken.findOneAndUpdate(
      {
        _id: resetRecord._id,
        usedAt: null,
        expiresAt: { $gt: new Date() }
      },
      { $set: { usedAt: new Date() } },
      { new: true }
    );

    if (!claimedToken) {
      return res.status(400).json({
        message: "The reset link is invalid, expired, or already used."
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      claimedToken.userId,
      { $set: { password: passwordHash } },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(400).json({
        message: "The account could not be found."
      });
    }

    await PasswordResetToken.deleteMany({ userId: claimedToken.userId });

    return res.status(200).json({
      message: "Password reset successfully. You can now log in."
    });
  } catch (error) {
    console.error("Reset password error:", error.message);
    return res.status(500).json({
      message: "Unable to reset the password right now."
    });
  }
}

module.exports = { forgotPassword, resetPassword };
