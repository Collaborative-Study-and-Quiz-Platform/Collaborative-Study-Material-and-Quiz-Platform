const jwt = require("jsonwebtoken");
const { getJwtConfig } = require("../config/auth");

function authenticateToken(req, res, next) {
  const authorization = req.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      status: "error",
      message: "Authentication required"
    });
  }

  try {
    const { secret } = getJwtConfig();
    const payload = jwt.verify(token, secret);
    req.user = {
      id: payload.sub,
      role: payload.role
    };
    return next();
  } catch (error) {
    return res.status(401).json({
      status: "error",
      message: "Invalid or expired token"
    });
  }
}

module.exports = authenticateToken;
