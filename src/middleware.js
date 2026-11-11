const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.fw_token;
  if (!token) return res.status(401).json({ error: "Not authenticated." });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.sub, email: payload.email,
      isAdmin: !!payload.isAdmin, impersonatedBy: payload.impersonatedBy || null,
    };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired or invalid." });
  }
}

// Naturally false on an impersonation token (isAdmin is only ever true on the real
// admin's own token), so an admin mid-impersonation can't reopen the admin dashboard
// without exiting first — that's intentional, not a gap.
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "Admin access required." });
  next();
}

requireAuth.requireAdmin = requireAdmin;
module.exports = requireAuth;
