const nodemailer = require("nodemailer");
const Notification = require("../../models/Notification");
const User = require("../../models/User");

function getEmailTransporter() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM
  } = process.env;
  const values = [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM];
  if (values.every((value) => !value)) {
    return null;
  }
  if (values.some((value) => !value)
    || !/^\d+$/.test(SMTP_PORT)
    || Number(SMTP_PORT) < 1
    || Number(SMTP_PORT) > 65535
    || !["true", "false"].includes(SMTP_SECURE)) {
    throw new Error("SMTP settings are incomplete or invalid");
  }

  return {
    from: SMTP_FROM,
    transporter: nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE === "true",
      requireTLS: SMTP_SECURE !== "true",
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    })
  };
}

async function createNotification({ userId, type, title, message, metadata = {} }) {
  const notification = await Notification.create({
    userId,
    type,
    title,
    message,
    metadata
  });

  try {
    const email = getEmailTransporter();
    if (!email) {
      if (process.env.NODE_ENV === "production") {
        console.warn("Notification email was not sent: SMTP is not configured");
      }
      return notification;
    }

    const user = await User.findById(userId).select("email");
    if (!user) {
      throw new Error("Notification recipient was not found");
    }
    await email.transporter.sendMail({
      from: email.from,
      to: user.email,
      subject: title,
      text: message
    });
  } catch (error) {
    console.error("Notification email delivery failed:", error.message);
  }

  return notification;
}

module.exports = { createNotification, getEmailTransporter };