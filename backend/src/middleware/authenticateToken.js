const jwt = require("jsonwebtoken");
const { getJwtConfig } = require("../config/auth");

function authenticateToken(req, res, next) {
  const authorization = (req.get("authorization") || "").trim();
  const [scheme, ...tokenParts] = authorization.split(/\s+/);
  const token = tokenParts.join(" ");

  if (!scheme || !/^bearer$/i.test(scheme) || !token) {
    return res.status(401).json({
      status: "error",
      message: "Authentication required"
    });
  }

  try {
    const { secret } = getJwtConfig();
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || !payload.sub.trim()) {
      return res.status(401).json({
        status: "error",
        message: "Invalid or expired token"
      });
    }
    const roles = new Set(["student", "instructor", "admin"]);
    if (typeof payload.role !== "string"
      || !roles.has(payload.role.trim().toLowerCase())) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to access this resource"
      });
    }
    req.user = {
      id: payload.sub.trim(),
      role: payload.role.trim().toLowerCase()
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
