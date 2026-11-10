function requireSecureTransport(req, res, next) {
  if (process.env.NODE_ENV === "production" && !req.secure) {
    return res.status(426).json({
      status: "error",
      message: "HTTPS is required"
    });
  }
  if (req.secure) {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return next();
}

module.exports = requireSecureTransport;
