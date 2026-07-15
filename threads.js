// ============================================================================
// Synthara — threads
// Chat history lives server-side per account.
// ============================================================================

const store = require("./db");
const { requireAuth } = require("./auth");

const MAX_TITLE_LEN = 120;
const MAX_MESSAGES_PER_THREAD = 500;

function registerThreadRoutes(app) {
  app.get("/api/threads", requireAuth, async (req, res, next) => {
    try {
      res.json({ threads: await store.listThreads(req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/threads", requireAuth, async (req, res, next) => {
    try {
      const { title, messages, pinned } = req.body || {};
      if (!Array.isArray(messages)) return res.status(400).json({ error: "messages must be an array." });
      const thread = await store.createThread({
        userId: req.user.id,
        title: (title || "New chat").toString().slice(0, MAX_TITLE_LEN),
        pinned: !!pinned,
        messages: messages.slice(0, MAX_MESSAGES_PER_THREAD),
      });
      res.status(201).json({ thread });
    } catch (err) {
      next(err);
    }
  });

  app.patch("/api/threads/:id", requireAuth, async (req, res, next) => {
    try {
      const { title, messages, pinned } = req.body || {};
      const patch = {};
      if (title !== undefined) patch.title = title.toString().slice(0, MAX_TITLE_LEN);
      if (pinned !== undefined) patch.pinned = !!pinned;
      if (messages !== undefined) {
        if (!Array.isArray(messages)) return res.status(400).json({ error: "messages must be an array." });
        patch.messages = messages.slice(0, MAX_MESSAGES_PER_THREAD);
      }
      const thread = await store.updateThread(req.params.id, req.user.id, patch);
      if (!thread) return res.status(404).json({ error: "Thread not found." });
      res.json({ thread });
    } catch (err) {
      next(err);
    }
  });

  app.delete("/api/threads/:id", requireAuth, async (req, res, next) => {
    try {
      await store.deleteThread(req.params.id, req.user.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.delete("/api/threads", requireAuth, async (req, res, next) => {
    try {
      await store.deleteAllThreads(req.user.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerThreadRoutes };
