# Synthara — Fused Intelligence Platform

A self-hosted chat app: sidebar with threads, a model picker across multiple
providers, file/image uploads, and a streaming chat composer — in a navy /
brushed-silver / copper design.

## What's new in this version

- **Deployable to Vercel now, too.** The database layer runs on libSQL,
  which works two ways with zero code differences: a local file (what you
  get by default — same as before) or a hosted [Turso](https://turso.tech)
  database, which is what makes it work on Vercel's read-only, stateless
  functions. See "Deploying it publicly" below.
- **Real accounts + a database.** Email/password sign-up, sessions stored
  server-side, and everything — chats, pins, shared links — now lives in a
  database tied to your account instead of the browser. Log in from
  any device and your chats are there.
- **Settings → Profile** now matches the layout you referenced: display
  name, email, log out, log out everywhere, and delete account (which
  cascades — deletes the account, every chat, and every shared link).
- **Chats are named by actually reading them**, not by truncating your
  first message. After the first reply, Synthara asks the same model you're
  chatting with to name the conversation using two steps: contextual
  understanding (what is this conversation actually about) and entity
  recognition (pull out the specific person/place/topic/technology that
  matters most), then produce a short title from that. This runs through
  the same request path for every provider, so it works identically whether
  you're on Gemini, Groq, or OpenRouter. If it fails for any reason, the
  original truncated title is kept — you never end up with a blank title.
- Renamed to Synthara, with a navy/platinum/copper palette pulled from the
  logo concept you shared. Swap `--violet`/`--cyan`/`--pink` in
  `style.css` once you upload the final logo file if the exact tones need
  matching more precisely.
- **Settings tabs** (General / Profile / Data / About), matching the layout
  you referenced — includes a working **Light / Dark / System** theme
  switcher.
- **Share a chat**: the share icon in the top bar publishes a read-only
  snapshot of the current conversation to a link anyone can open (no login
  needed to view, but you need an account to create one). Manage everything
  you've shared from Settings → Data.
- **One sidebar toggle**, not two — a single icon in the top bar opens and
  closes it, on both desktop and mobile.
- **API keys live on the server only**, read from environment variables.
  Nothing is entered or stored in the browser — this makes the app safe to
  actually put in front of other people.
- **File & image uploads**: drop in text files, code, PDFs, or images
  (paste or attach). PDFs are parsed server-side; images are sent straight
  to vision-capable models.
- **Stop / Regenerate / Edit / Copy** on messages, plus **pin / rename /
  delete** on threads.
- **Mobile responsive**: the sidebar becomes a slide-in drawer, inputs are
  sized to avoid iOS auto-zoom, and layouts collapse cleanly down to small
  phones.
- **Rate limiting + security headers** (helmet, per-IP limits on chat,
  uploads, shares, and auth) since this is meant to be public-facing.
  Passwords are hashed with bcrypt; sessions are httpOnly cookies, not
  tokens sitting in localStorage.

## Set up your API keys (server-side)

```bash
cp .env.example .env
```

Open `.env` and paste in a key for at least one provider — you only need
one to get started:

- **Google Gemini** — free tier: https://aistudio.google.com/apikey
- **Groq** — free tier, fast Llama/GPT-OSS models: https://console.groq.com/keys
- **OpenRouter** — several `:free` models: https://openrouter.ai/keys

Any provider without a key simply shows as "unavailable" in the model
picker — nothing breaks if you only fill in one.

## Run it locally

Requires Node.js 18+.

```bash
npm install
npm start
```

Open **http://localhost:3000**.

## Deploying it publicly

### Option A: Railway, Render, Fly.io, or a VPS (a real disk, an always-on process)

This is the simplest path — the app runs exactly like it does with `npm start`
locally, no code changes needed.

1. Connect the GitHub repo, set the start command to `npm start` (most of
   these auto-detect it).
2. **Attach a persistent volume** and point it at the `data/` folder — this
   is the step people skip and then lose all their data on the next deploy.
   Without a volume, the filesystem resets and `data/synthara.db` (every
   account, chat, and share) goes with it.
3. Set environment variables: at least one provider key
   (`GEMINI_API_KEY`/`GROQ_API_KEY`/`OPENROUTER_API_KEY`), and optionally the
   rate-limit tuning vars below. Don't set `PORT` — these platforms inject it
   automatically and the app already reads `process.env.PORT`.
4. Make sure the platform terminates HTTPS for you (Railway/Render do this
   automatically with their generated domains) — the session cookie requires
   HTTPS in production or login won't work.

### Option B: Vercel (serverless — needs a hosted database)

Vercel's functions have a **read-only filesystem** and don't stay running
between requests, so the local SQLite file this app uses by default won't
work there — it needs a real hosted database instead. This repo is already
set up for [Turso](https://turso.tech) (a hosted libSQL database — same SQL
dialect as SQLite, generous free tier, and the only database this app
supports out of the box).

1. **Create a Turso database.**
   ```bash
   npm install -g @tursodatabase/cli   # or: curl -sSfL https://get.tur.so/install.sh | bash
   turso auth signup                    # or `turso auth login` if you have an account
   turso db create synthara
   turso db show synthara --url         # -> TURSO_DATABASE_URL
   turso db tokens create synthara      # -> TURSO_AUTH_TOKEN
   ```
2. **Import the repo into Vercel** (vercel.com → Add New → Project → your
   GitHub repo). Vercel will detect `vercel.json` and `api/index.js`
   automatically — no build configuration needed.
3. **Set environment variables** in the Vercel project settings:
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and at least one provider key.
   If `TURSO_DATABASE_URL` is missing, the app will fail to start with a
   clear error rather than silently losing data — check the function logs
   if something's wrong.
4. Deploy. Vercel handles HTTPS automatically, so the session cookie works
   out of the box.

Two things that behave slightly differently on Vercel than on a normal
server: rate limiting is per-instance (in-memory), so it's a softer limit
than on an always-on host — each cold serverless instance starts its own
counter. And very long AI responses could bump into the function duration
limit (`maxDuration: 60` in `vercel.json` — raise it if you're on a paid
plan and hitting timeouts on long generations).

### Either way

1. **Tune the rate limits** in your env vars (`CHAT_RATE_LIMIT`,
   `UPLOAD_RATE_LIMIT`, `SHARE_RATE_LIMIT`, `AUTH_RATE_LIMIT`) to match how
   much abuse you're comfortable absorbing.
2. **Back up your database** — whether that's `data/synthara.db` on a
   volume or your Turso database, it's the entire app's data: every
   account, chat, and shared link.
3. **Accounts are already required to chat**, upload, or share — but
   anyone can sign up (there's no invite/allowlist system), so this isn't
   the same as private access.
4. **Watch provider spend** — free tiers have caps; check each provider's
   dashboard periodically.

## Project structure

```
synthara/
├── server.js          # Express app: provider proxy (chat + titles), uploads, security headers
├── db.js              # libSQL schema + queries (users, sessions, threads, shares)
├── auth.js            # Signup/login/logout/profile/delete-account routes + session middleware
├── threads.js         # Thread CRUD routes (all require login)
├── shares.js           # Share creation/viewing/management routes
├── api/index.js         # Vercel entrypoint — re-exports the Express app, unused elsewhere
├── vercel.json           # Routes every request through api/index.js on Vercel
├── package.json
├── .env.example
├── data/               # Local-file database lives here (dev / non-Vercel hosts) — back this up, gitignored
├── public/
│   ├── index.html      # App shell + auth screen
│   ├── style.css        # Design system
│   └── app.js             # Auth flow, threads, model picker, uploads, streaming chat logic
```

## Adding another provider

Open `server.js` and add an entry to the `PROVIDERS` object with a `kind` of
either `"gemini"` or `"openai"` (any OpenAI-compatible `/chat/completions`
endpoint — Groq, OpenRouter, Together, Fireworks, local Ollama with the
OpenAI shim, etc.), plus an `envKey` naming the environment variable that
holds its key. The frontend picks up new providers automatically, and
title-generation (`/api/title`) works for it immediately too — no
provider-specific naming code needed.

## Notes

- Chats, pins, and shared links are stored in a libSQL database — a local
  file at `data/synthara.db` by default, or your Turso database if
  `TURSO_DATABASE_URL` is set — tied to your account, so logging in from
  another device shows the same chats.
- Theme choice and which model you last used are the only things still kept
  per-browser (in `localStorage`), since those are display preferences, not
  data you'd want to sync.
- Uploaded files: images and plain-text/code files are read entirely in the
  browser and sent as part of the request; PDFs are parsed on the server
  (text-only, up to ~30,000 characters) and never written to disk.
- The composer sends on `Enter`, inserts a newline on `Shift+Enter`, and you
  can paste an image directly into it.
