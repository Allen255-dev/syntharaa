// ============================================================================
// Synthara — backend
// API keys live only here, in environment variables. The browser never sees
// them. Every route is rate-limited since this is meant to be public-facing.
// ============================================================================

const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const fetch = require("node-fetch");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const { attachUser, requireAuth, registerAuthRoutes } = require("./auth");
const { registerThreadRoutes } = require("./threads");
const { registerShareRoutes } = require("./shares");

const app = express();
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());
app.use(express.json({ limit: "2mb" })); // chat payloads (text only — files go through /api/upload)
app.use(cookieParser());
app.use(attachUser);
app.use(express.static("public", { maxAge: "1h" }));

registerAuthRoutes(app);
registerThreadRoutes(app);
registerShareRoutes(app);

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Provider registry. Each provider reads its key from an env var — set these
// in a .env file (see .env.example). A provider with no key set simply shows
// as unavailable in the UI; nothing crashes.
// ---------------------------------------------------------------------------
const PROVIDERS = {
  gemini: {
    kind: "gemini",
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    supportsVision: true,
    models: [{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }],
  },
  groq: {
    kind: "openai",
    label: "Groq",
    envKey: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    supportsVision: true,
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
      { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout (vision)" },
    ],
  },
  openrouter: {
    kind: "openai",
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    supportsVision: false,
    models: [
      { id: "openrouter/free", label: "Auto — best free model" },
      { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)" },
      { id: "meta-llama/llama-4-maverick:free", label: "Llama 4 Maverick (free)" },
      { id: "openai/gpt-oss-20b:free", label: "GPT-OSS 20B (free)" },
    ],
  },
};

function providerAvailable(id) {
  const cfg = PROVIDERS[id];
  return !!(cfg && process.env[cfg.envKey]);
}

// Public view of the registry — never includes the key itself.
app.get("/api/providers", (req, res) => {
  const out = {};
  for (const [id, cfg] of Object.entries(PROVIDERS)) {
    out[id] = {
      label: cfg.label,
      supportsVision: cfg.supportsVision,
      available: providerAvailable(id),
      models: cfg.models,
    };
  }
  res.json(out);
});

// ---------------------------------------------------------------------------
// Rate limiting — protects your API quota once this is public.
// Tune via env vars if you need more/less headroom.
// ---------------------------------------------------------------------------
const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: Number(process.env.CHAT_RATE_LIMIT || 40),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You're sending messages too fast. Please wait a bit and try again." },
});
const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: Number(process.env.UPLOAD_RATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads. Please wait a bit and try again." },
});

// ---------------------------------------------------------------------------
// POST /api/upload — extracts text from a PDF so it can be attached to a
// chat message as context. Images and plain-text files are handled entirely
// client-side and never hit this route.
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

app.post("/api/upload", uploadLimiter, requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file received." });
    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Only PDF uploads go through this endpoint." });
    }
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(req.file.buffer);
    const text = (data.text || "").trim().slice(0, 30000); // keep prompts sane
    if (!text) return res.status(422).json({ error: "Couldn't extract any text from that PDF." });
    res.json({ text, pages: data.numpages });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: "Failed to process that file." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/chat  { provider, model, messages, attachments? }
// messages: [{ role: 'user'|'assistant', content: string }]
// attachments (optional, on the latest user turn only): [{ mimeType, dataUrl }]
// Streams plain-text chunks back to the client as they arrive.
// ---------------------------------------------------------------------------
app.post("/api/chat", chatLimiter, requireAuth, async (req, res) => {
  const { provider, model, messages, attachments } = req.body || {};

  if (!provider || !PROVIDERS[provider]) {
    return res.status(400).json({ error: "Unknown or missing provider." });
  }
  if (!providerAvailable(provider)) {
    return res.status(400).json({ error: `${PROVIDERS[provider].label} isn't configured on this server yet.` });
  }
  if (!model) return res.status(400).json({ error: "Missing model." });
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing messages." });
  }

  const config = PROVIDERS[provider];
  const apiKey = process.env[config.envKey];
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  const streamState = { started: false };

  try {
    if (config.kind === "gemini") {
      await streamGemini({ config, model, apiKey, messages, attachments, res, signal: controller.signal, streamState });
    } else {
      await streamOpenAICompatible({ config, model, apiKey, messages, attachments, res, signal: controller.signal, streamState });
    }
  } catch (err) {
    if (err.name === "AbortError") return res.end();
    console.error("Chat proxy error:", err.message);
    if (!streamState.started) {
      // Nothing has been sent to the client yet — reply with a proper JSON
      // error and the real upstream status code instead of a blind 502.
      return res.status(err.status || 502).json({ error: err.message });
    }
    // We were already mid-stream (plain text) when this failed — append
    // a readable note to what the user has already started seeing.
    res.write(`\n\n[Error: ${err.message}]`);
  }
  res.end();
});

function dataUrlToBase64(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

// ---------------------------------------------------------------------------
// POST /api/title — names a chat the way a good librarian would: read the
// exchange, understand what it's actually about, and pull out the entity or
// concept that matters most. Works the same way regardless of which
// provider/model is doing the writing, since it just reuses that provider's
// normal (non-streaming) completion call with a naming-specific prompt.
// ---------------------------------------------------------------------------
const TITLE_INSTRUCTIONS = `You are naming a chat conversation so it can be found again later in a sidebar list. Follow this process:
1. Contextual understanding — read the exchange and identify the key concepts, entities, and relationships being discussed.
2. Entity recognition — identify any specific entities mentioned (people, places, organizations, products, technologies, proper nouns) and prefer using the most important one in the title.
Then produce a title that is 3-6 words, in title case, no surrounding quotes, no trailing punctuation, and no explanation. Reply with ONLY the title itself.`;

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/^["'“”\s]+|["'“”\s.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .trim();
}

async function generateTitle({ config, model, apiKey, userText, assistantText }) {
  const conversation = `User: ${userText}\nAssistant: ${assistantText}`.slice(0, 4000);

  if (config.kind === "gemini") {
    const url = `${config.baseUrl}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${TITLE_INSTRUCTIONS}\n\nConversation:\n${conversation}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 20 },
      }),
    });
    if (!upstream.ok) throw upstreamError("Gemini", upstream, await upstream.text());
    const data = await upstream.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    return cleanTitle(text);
  }

  const upstream = await fetch(config.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: TITLE_INSTRUCTIONS },
        { role: "user", content: conversation },
      ],
      temperature: 0.2,
      max_tokens: 20,
      stream: false,
    }),
  });
  if (!upstream.ok) throw upstreamError(config.label, upstream, await upstream.text());
  const data = await upstream.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return cleanTitle(text);
}

app.post("/api/title", chatLimiter, requireAuth, async (req, res) => {
  const { provider, model, messages } = req.body || {};
  if (!provider || !PROVIDERS[provider]) return res.status(400).json({ error: "Unknown or missing provider." });
  if (!providerAvailable(provider)) return res.status(400).json({ error: `${PROVIDERS[provider].label} isn't configured on this server yet.` });
  if (!model) return res.status(400).json({ error: "Missing model." });
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "Missing messages." });

  const config = PROVIDERS[provider];
  const apiKey = process.env[config.envKey];
  const userText = messages.find((m) => m.role === "user")?.content || "";
  const assistantText = messages.find((m) => m.role === "assistant")?.content || "";

  try {
    const title = await generateTitle({ config, model, apiKey, userText, assistantText });
    if (!title) throw new Error("Model returned an empty title.");
    res.json({ title });
  } catch (err) {
    console.error("Title generation error:", err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
});

function upstreamError(label, upstream, bodyText) {
  const err = new Error(`${label} error (${upstream.status}): ${bodyText.slice(0, 300) || upstream.statusText}`);
  // Pass through 4xx as-is (bad key, bad model, rate limit); collapse other
  // upstream failures to 502 since they're not the client's fault.
  err.status = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502;
  return err;
}

async function streamGemini({ config, model, apiKey, messages, attachments, res, signal, streamState }) {
  const system = messages.find((m) => m.role === "system");
  const turns = messages.filter((m) => m.role !== "system");
  const lastIndex = turns.length - 1;

  const body = {
    contents: turns.map((m, i) => {
      const parts = [{ text: m.content }];
      if (i === lastIndex && m.role === "user" && Array.isArray(attachments)) {
        for (const att of attachments) {
          const decoded = dataUrlToBase64(att.dataUrl);
          if (decoded) parts.push({ inlineData: { mimeType: decoded.mimeType, data: decoded.base64 } });
        }
      }
      return { role: m.role === "assistant" ? "model" : "user", parts };
    }),
  };
  if (system) body.systemInstruction = { parts: [{ text: system.content }] };

  const url = `${config.baseUrl}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!upstream.ok) {
    throw upstreamError("Gemini", upstream, await upstream.text());
  }

  await pipeSSE(upstream, res, streamState, (payload) => {
    try {
      const json = JSON.parse(payload);
      const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
      return text || "";
    } catch {
      return "";
    }
  });
}

async function streamOpenAICompatible({ config, model, apiKey, messages, attachments, res, signal, streamState }) {
  const lastIndex = messages.length - 1;
  const formatted = messages.map((m, i) => {
    if (i === lastIndex && m.role === "user" && Array.isArray(attachments) && attachments.length && config.supportsVision) {
      const content = [{ type: "text", text: m.content }];
      for (const att of attachments) {
        content.push({ type: "image_url", image_url: { url: att.dataUrl } });
      }
      return { role: m.role, content };
    }
    return { role: m.role, content: m.content };
  });

  const upstream = await fetch(config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: formatted, stream: true }),
    signal,
  });

  if (!upstream.ok) {
    throw upstreamError(config.label, upstream, await upstream.text());
  }

  await pipeSSE(upstream, res, streamState, (payload) => {
    if (payload === "[DONE]") return "";
    try {
      const json = JSON.parse(payload);
      return json?.choices?.[0]?.delta?.content || "";
    } catch {
      return "";
    }
  });
}

async function pipeSSE(upstream, res, streamState, extract) {
  let buffer = "";
  for await (const chunk of upstream.body) {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      const text = extract(payload);
      if (text) {
        if (!streamState.started) {
          streamState.started = true;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Transfer-Encoding", "chunked");
        }
        res.write(text);
      }
    }
  }
}

// Multer / generic error handler (keeps stack traces off the client)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: "File is too large (8MB max)." });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong on our end." });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    const configured = Object.keys(PROVIDERS).filter(providerAvailable);
    console.log(`Synthara running at http://localhost:${PORT}`);
    console.log(
      configured.length
        ? `Providers configured: ${configured.join(", ")}`
        : `⚠️  No provider API keys found — copy .env.example to .env and add at least one key.`
    );
  });
}

module.exports = app;
