// ============================================================================
// Synthara — shared links
// Creating and managing a share requires an account; viewing one doesn't.
// ============================================================================

const path = require("path");
const rateLimit = require("express-rate-limit");
const store = require("./db");
const { requireAuth } = require("./auth");

const MAX_SHARE_MESSAGES = 200;

const shareLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: Number(process.env.SHARE_RATE_LIMIT || 15),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many share links created. Please wait a bit and try again." },
});

function registerShareRoutes(app) {
  app.post("/api/share", shareLimiter, requireAuth, async (req, res, next) => {
    try {
      const { title, messages } = req.body || {};
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Nothing to share yet." });
      }
      const cleanMessages = messages.slice(0, MAX_SHARE_MESSAGES).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || "").slice(0, 20000),
        attachments: Array.isArray(m.attachments)
          ? m.attachments.map((a) => ({ name: a.name, kind: a.kind }))
          : undefined,
      }));

      const share = await store.createShare({
        userId: req.user.id,
        title: (title || "Shared chat").toString().slice(0, 120),
        messages: cleanMessages,
      });

      res.json({ id: share.id, url: `${req.protocol}://${req.get("host")}/share/${share.id}` });
    } catch (err) {
      next(err);
    }
  });

  // Public — anyone with the link can view, no account needed.
  app.get("/api/share/:id", async (req, res, next) => {
    try {
      const share = await store.getShare(req.params.id);
      if (!share) return res.status(404).json({ error: "This shared chat wasn't found — it may have been deleted." });
      res.json({ title: share.title, createdAt: share.created_at, messages: share.messages });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/shares", requireAuth, async (req, res, next) => {
    try {
      res.json({ shares: await store.listSharesForUser(req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  app.delete("/api/share/:id", requireAuth, async (req, res, next) => {
    try {
      const deleted = await store.deleteShare(req.params.id, req.user.id);
      if (!deleted) return res.status(404).json({ error: "Not found, or it isn't yours to delete." });
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  });

  // Serve the SPA for share links so the client can detect the /share/:id
  // path and render the read-only view.
  app.get("/share/:id", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });
}

module.exports = { registerShareRoutes };
