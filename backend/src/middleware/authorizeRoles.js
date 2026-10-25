const SUPPORTED_ROLES = new Set(["student", "instructor", "admin"]);

function authorizeRoles(...allowedRoles) {
  const roles = allowedRoles.map((role) => (
    typeof role === "string" ? role.trim().toLowerCase() : ""
  ));
  const configurationIsValid = roles.length > 0
    && roles.every((role) => SUPPORTED_ROLES.has(role));

  return (req, res, next) => {
    if (!configurationIsValid || !req.user || !SUPPORTED_ROLES.has(req.user.role)) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to access this resource"
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to access this resource"
      });
    }

    return next();
  };
}

module.exports = authorizeRoles;
