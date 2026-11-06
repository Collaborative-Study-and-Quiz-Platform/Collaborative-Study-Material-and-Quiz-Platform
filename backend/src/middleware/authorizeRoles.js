const SUPPORTED_ROLES = new Set(["student", "instructor", "admin"]);

function authorizeRoles(...allowedRoles) {
  const roles = allowedRoles
    .filter((role) => typeof role === "string")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
  const configurationIsValid = roles.length > 0
    && roles.every((role) => SUPPORTED_ROLES.has(role));

  return (req, res, next) => {
    const userRole = typeof req.user?.role === "string"
      ? req.user.role.trim().toLowerCase()
      : "";
    if (!configurationIsValid || !req.user || !SUPPORTED_ROLES.has(userRole)) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to access this resource"
      });
    }

    if (!roles.includes(userRole)) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to access this resource"
      });
    }

    req.user.role = userRole;
    return next();
  };
}

module.exports = authorizeRoles;
