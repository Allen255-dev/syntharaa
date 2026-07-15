// ============================================================================
// Synthara — auth
// Email + password accounts, sessions stored in the database, session id
// delivered as an httpOnly cookie. No third-party auth provider — this is
// meant to be simple enough to self-host without extra moving parts.
// ============================================================================

const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const store = require("./db");

const COOKIE_NAME = "sid";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    maxAge: store.SESSION_TTL_MS,
    path: "/",
  };
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name, createdAt: user.created_at };
}

// Attaches req.user (or null) based on the session cookie. Never blocks the
// request — routes that require login use requireAuth below. Async because
// the database call is, but never rejects the request on a DB hiccup: worst
// case, req.user just stays null and requireAuth routes will 401 normally.
async function attachUser(req, res, next) {
  req.user = null;
  try {
    const sid = req.cookies?.[COOKIE_NAME];
    if (sid) {
      const session = await store.getSession(sid);
      if (session) {
        const user = await store.findUserById(session.user_id);
        if (user) req.user = user;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in to do that." });
  next();
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a bit and try again." },
});

function registerAuthRoutes(app) {
  app.post("/api/auth/signup", authLimiter, async (req, res, next) => {
    try {
      const { email, password, displayName } = req.body || {};
      if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
      if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
      const name = (displayName || email.split("@")[0]).toString().trim().slice(0, 40) || "Friend";

      if (await store.findUserByEmail(email)) {
        return res.status(409).json({ error: "An account with that email already exists." });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await store.createUser({ email: email.toLowerCase(), passwordHash, displayName: name });
      const sid = await store.createSession(user.id);
      res.cookie(COOKIE_NAME, sid, cookieOptions(req));
      res.json({ user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: "Enter your email and password." });

      const user = await store.findUserByEmail(email);
      const ok = user && (await bcrypt.compare(password, user.password_hash));
      if (!ok) return res.status(401).json({ error: "Incorrect email or password." });

      const sid = await store.createSession(user.id);
      res.cookie(COOKIE_NAME, sid, cookieOptions(req));
      res.json({ user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/auth/logout", async (req, res, next) => {
    try {
      const sid = req.cookies?.[COOKIE_NAME];
      if (sid) await store.deleteSession(sid);
      res.clearCookie(COOKIE_NAME, { path: "/" });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/auth/logout-all", requireAuth, async (req, res, next) => {
    try {
      await store.deleteAllSessionsForUser(req.user.id);
      res.clearCookie(COOKIE_NAME, { path: "/" });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ user: req.user ? publicUser(req.user) : null });
  });

  app.patch("/api/auth/profile", requireAuth, async (req, res, next) => {
    try {
      const name = (req.body?.displayName || "").toString().trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: "Display name can't be empty." });
      await store.updateDisplayName(req.user.id, name);
      res.json({ user: publicUser(await store.findUserById(req.user.id)) });
    } catch (err) {
      next(err);
    }
  });

  app.delete("/api/auth/account", requireAuth, async (req, res, next) => {
    try {
      await store.deleteUser(req.user.id); // cascades to sessions, threads, shares
      res.clearCookie(COOKIE_NAME, { path: "/" });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { attachUser, requireAuth, registerAuthRoutes };
