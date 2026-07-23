# UNAI — Union of Nations AI Assistant

> **Already have this running and just pulled an update?** After replacing files, run `npm install` again before `npm start` — new features sometimes add new dependencies (e.g. PDF/DOCX support added `pdf-parse` and `mammoth`), and a stale `node_modules` will throw `Cannot find module` errors otherwise.

A Discord assistant for your Politics & War alliance. Built around:
- **Silence by default** — it only answers when it's confident and on-topic.
- **RAG knowledge base** — answers are grounded in your Constitution, guides, and FAQs, not guesses.
- **Government-first** — it never approves grants, declares war, votes, or makes binding decisions. It escalates those to a channel you choose.
- **Provider-agnostic AI** — runs on Google Gemini's free tier by default; switch to OpenAI or Anthropic with one command, no code changes.
- **Fully configurable from Discord** — no code editing after setup.

Integrations with your future Banking/Audit/Legislation bots are intentionally **not** built yet (they don't exist to connect to) — but the architecture (`src/ai`, `src/knowledge`, `src/engine`, `src/permissions`) is modular so they can be added later as new files without rewriting what's here.

---

## Part 1 — Get your Discord credentials

You said the bot is already invited to your server, so you likely have most of this. If not:

1. Go to https://discord.com/developers/applications and open your bot's application.
2. **Bot Token:** Left sidebar → "Bot" → click "Reset Token" (or "View Token") → copy it. Treat this like a password — anyone with it can control your bot.
3. **Client ID:** Left sidebar → "OAuth2" → "General" → copy "Client ID" (this is also your Application ID, shown on the "General Information" page).
4. **Enable Privileged Intents:** Left sidebar → "Bot" → scroll to "Privileged Gateway Intents" → turn ON **Message Content Intent** and **Server Members Intent**. Save changes. Without these, the bot cannot read message text or your role structure.
5. **Your server's Guild ID** (used for instant command testing): In Discord, enable Developer Mode (User Settings → Advanced → Developer Mode), then right-click your server icon → "Copy Server ID".

Make sure the bot's invite included the `applications.commands` and `bot` scopes with at least these permissions: **Send Messages, Read Message History, View Channels, Use Slash Commands**. If you're not sure, re-invite it using OAuth2 → URL Generator with those checked.

---

## Part 2 — Get your AI provider key

**Default for Version 1.0 is Google Gemini**, so you can develop and test on its free tier with no credit card:

1. Go to https://aistudio.google.com/apikey → "Create API key". That's it — no billing setup needed for the free tier.
2. Free tier note: `gemini-flash-lite-latest` (the default model here) has kept the most generous free-tier rate limits in the current Gemini lineup, but they're still finite — roughly 15-30 requests/minute and ~1,000-1,500/day, shared across both the classification call and the answer-generation call UNAI makes per question. Fine for testing and a small/medium alliance; if you outgrow it, either enable billing on the same Google AI Studio project (pay-as-you-go, no code change) or switch providers. Avoid switching `GEMINI_MODEL` to the plain `gemini-flash-latest` alias — at time of writing it resolves to a brand-new preview model with a much tighter free quota (as low as 20/day), which is enough to break a live bot within minutes.

**If/when you want to switch later** (e.g. to OpenAI for higher throughput, or Anthropic):
- OpenAI: https://platform.openai.com/api-keys → "Create new secret key" (requires billing enabled, even light usage costs a few cents).
- Anthropic: https://console.anthropic.com/settings/keys

Switching is just `/ai provider openai` (or `anthropic`) in Discord — no code or redeploy needed, as long as the matching API key is already set as an environment variable. One nuance: Anthropic has no embeddings API, so if you switch chat to Anthropic, keep `GEMINI_API_KEY` or `OPENAI_API_KEY` set too — the knowledge-base search will keep using one of those automatically for embeddings even while Claude handles the conversation.

---

## Part 3 — Run it locally in VS Code (to test before deploying)

### Which Node.js version to use

This project was built and syntax-tested on **Node 22** (specifically v22.22.2). Use **Node 22 LTS**, or **Node 20 LTS** if you'd rather — both have prebuilt `better-sqlite3` binaries available, so `npm install` just downloads a precompiled binary and finishes in seconds with no compiler needed.

Your error on Node 24.13.0 is exactly that: `better-sqlite3`'s prebuilt-binary releases lag behind the newest Node major version for a while after it ships, so npm falls back to compiling from source, which needs Visual Studio Build Tools (or Python + a C++ toolchain) on Windows. Switching to Node 22 LTS avoids that entirely — you won't need Build Tools.

The easiest way to switch versions cleanly (and go back later if needed) is [nvm-windows](https://github.com/coreybutler/nvm-windows/releases):
```
nvm install 22
nvm use 22
node --version    (should print v22.x.x)
```
`package.json` also now declares `"engines": { "node": "20.x || 22.x" }` as a hint for this.

### Setup

1. Open the `unai` folder in VS Code (File → Open Folder).
2. Open the built-in terminal: `Terminal` → `New Terminal`.
3. Install dependencies:
   ```
   npm install
   ```
4. Copy the example environment file and fill it in:
   ```
   cp .env.example .env
   ```
   Open `.env` in the editor and paste in:
   - `DISCORD_TOKEN` (Part 1, step 2)
   - `DISCORD_CLIENT_ID` (Part 1, step 3)
   - `DISCORD_GUILD_ID` (Part 1, step 5 — for instant command updates while testing)
   - `GEMINI_API_KEY` (Part 2)
   - Leave everything else as-is for now.
5. Register the slash commands with Discord (only needs to be re-run when you change a command's options):
   ```
   npm run deploy-commands
   ```
   You should see "Done." If you see a 401 error, double check `DISCORD_TOKEN`. If 403/404, double-check `DISCORD_CLIENT_ID`.
6. Start the bot:
   ```
   npm start
   ```
   You should see `[UNAI] Logged in as YourBot#1234`.

### First-time configuration (run these as slash commands in Discord)

1. `/ai permissions set role:@YourGovernmentRole level:government` — repeat for each role tier you have (member/ministry/government/high_government/secgen). Server Administrators are automatically treated as Owner, so you (as server admin) can already run every command.
2. `/ai channels add channel:#questions` — repeat for each channel you want UNAI actively monitoring (e.g. #questions, #help, #new-members).
3. `/ai mode value:hybrid` — recommended default: responds when tagged anywhere, and auto-detects good questions in monitored channels.
4. `/ai confidence value:90`
5. `/ai escalation-channel channel:#gov-escalations` — where low-confidence or human-authority questions get flagged.
6. Upload your first document: `/knowledge upload file:[attach Constitution.pdf, .docx, .md, or .txt] title:"Constitution" category:constitution visibility:members_only`
7. Approve it so it's actually searchable: `/knowledge approve id:1`
8. Test it: ask a question in a monitored channel, or `@UNAI what does the Constitution say about elections?`

Supported upload formats: `.txt`, `.md`, `.pdf`, and `.docx`. Scanned/image-only PDFs won't work (no OCR) — if a PDF upload fails with "no extractable text found," it's likely a scan; re-export it as a text-based PDF or convert it to `.docx`/`.txt` first.

---

## Part 4 — Put the code on GitHub (no command-line git needed)

Railway deploys from a GitHub repo, so the code needs to live there.

1. Go to https://github.com/new — create a new **private** repository, e.g. `unai-bot`. Don't initialize it with a README (you already have one).
2. On the empty repo's page, click "uploading an existing file".
3. Drag in every file and folder from your local `unai` folder **except**: `node_modules/`, `.env`, and anything under `data/*.db`. (These are already excluded by `.gitignore`, but that only matters once you're using real `git` — the web upload doesn't know about `.gitignore`, so just don't drag those three in.)
4. Commit the upload.

Your `.env` file (with your real secrets) should **never** be uploaded to GitHub. It stays only on your computer and gets re-entered as Railway environment variables in the next part.

---

## Part 5 — Deploy to Railway (24/7 hosting)

1. Go to https://railway.app → sign in → "New Project" → "Deploy from GitHub repo" → select `unai-bot`.
2. Railway will detect Node.js automatically (via `railway.json` / Nixpacks) and start a build. It will fail on the first attempt — that's expected, because environment variables aren't set yet.
3. Click into the service → "Variables" tab → add each of these (same values as your local `.env`, minus `DATABASE_PATH` for now):
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID` (optional — remove this once you're happy, so commands register globally instead of just your server)
   - `AI_PROVIDER` = `gemini`
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL` = `gemini-flash-lite-latest`
   - `GEMINI_EMBEDDING_MODEL` = `gemini-embedding-001`
   - `DATABASE_PATH` = `/app/data/unai.db`
   - Railway runs whatever Node version its Nixpacks builder defaults to (currently a recent LTS), which should already be compatible — you don't need to fight the Node-version issue there like you might locally.
4. **Add a persistent volume** so your knowledge base and config survive redeploys: service → "Settings" → "Volumes" → "New Volume" → mount path `/app/data`.
5. Trigger a redeploy (Settings → "Redeploy", or push any change to GitHub). Check the "Deploy Logs" tab for `[UNAI] Logged in as...`.
6. Run `npm run deploy-commands` **one more time from your own computer** pointed at production (or just leave it — commands registered during local testing with `DISCORD_GUILD_ID` already work in your server; only re-run this script if you add/change a command later).

Your bot is now running 24/7. Railway restarts it automatically if it crashes (`restartPolicyType: ON_FAILURE` in `railway.json`).

### Ongoing costs to expect
- **Railway:** their free trial credit runs out eventually; a small bot like this typically costs a few dollars a month on the Hobby plan.
- **Gemini:** free while you stay within the free-tier rate limits (Part 2). If your alliance is active enough to hit them regularly, enable billing on the same Google AI Studio project — Gemini's paid tier is inexpensive — or switch providers with `/ai provider openai`. Use `/ai analytics` to watch response volume.
- **OpenAI (if you switch to it):** billed per token. With `gpt-4o-mini` and a moderate-traffic alliance server, expect a few dollars a month, not tens.

---

## Part 6 — Day-to-day admin commands

| Command | What it does |
|---|---|
| `/help` | Lists every UNAI command, grouped by category, paginated with buttons — always safe no matter how many commands exist |
| `/ai enable` / `/ai disable` | Turn UNAI on/off entirely |
| `/ai status` | See current configuration |
| `/ai mode value:tagged\|smart\|hybrid` | Change how UNAI decides to jump in |
| `/ai confidence value:90` | Raise/lower the bar for auto-answering |
| `/ai personality value:professional\|friendly\|mentor` | Change tone (never changes facts) |
| `/ai official-only value:true` | Only answer alliance-specific questions backed by an approved document |
| `/ai provider value:gemini\|openai\|anthropic` | Switch the AI brain |
| `/ai channels add/remove/list` | Control which channels UNAI watches |
| `/ai topics enable/disable/list` | Control which subjects UNAI will engage with |
| `/ai permissions set/remove/list` | Map Discord roles to access levels |
| `/ai analytics` | Usage stats, now including top topics and most-referenced documents |
| `/ai costs value:hours` | Estimated API usage and cost over a recent window |
| `/ai diagnose` | System health |
| `/ai lockdown value:true\|false` | Emergency lockdown — stronger and more visible than `/ai disable`; also pauses knowledge base changes |
| `/knowledge upload/approve/reject/archive/delete/reindex/list` | Manage documents (`.txt`, `.md`, `.pdf`, `.docx`) |
| `/knowledge update id:X file:...` | Replace a document's content, keeping full version history |
| `/knowledge versions id:X` | View a document's version history |
| `/sources add-google-doc link:... title:... category:...` | Link a Google Doc as a live-syncing knowledge source |
| `/sources list` / `sync` / `enable` / `disable` / `remove` | Manage knowledge sources |
| `/faq add/list/delete` | Manage quick FAQ answers |
| `/profile save/load/list/delete` | Save/apply named configuration snapshots (e.g. `war-mode`, `peace-mode`) |
| `/backup export` / `/backup import` | Download or restore a full backup (config, channels, topics, permissions, FAQ, documents) |
| `/review recent` / `/review inspect` / `/review rate` | Review past AI responses, in summary or full detail |
| `/review security` | View logged prompt-injection attempts, denied permissions, and spam patterns |

### How `/help` stays safe as the bot grows

`/help` builds its command list dynamically by reading whatever is actually registered in the bot (`interaction.client.commands`) — it's never manually maintained, so a new command shows up automatically, correctly categorized, the moment it's added to `index.js`.

The output always runs through `src/help/textPaginator.js`, which splits the full command list into pages capped well under Discord's real hard limits (4096 characters per embed description, 6000 per embed total) and never cuts a line in half. Navigation uses Previous/Next buttons rather than trying to cram everything into one message. This was stress-tested at 500 fake commands (10x the current set) and stayed correctly paginated — so growth in the command set can never break it. The same paginator is reusable by any future command whose output could grow unbounded.

### Prompt injection & abuse hardening (new)

Beyond the system prompt already instructing the model to resist override attempts, a fast deterministic check now runs *before* any AI call: messages matching common injection patterns ("ignore previous instructions", "reveal your system prompt", etc.) are blocked without ever reaching the model, and logged. The same stage also catches a user re-asking the identical question 3+ times within a minute (spam/abuse) and goes silent rather than replying repeatedly. Both are visible to admins via `/review security`.

---

### Emergency lockdown vs. disable

`/ai disable` is a normal off switch. `/ai lockdown value:true` (Section 99) is for active incidents: it stops all automatic responses immediately *and* pauses knowledge base changes (upload/approve/reindex/update all get blocked with a clear message) until you explicitly lift it with `/ai lockdown value:false`. Use it if something's actively wrong and you want to freeze the bot's state entirely while you sort it out.

### Document versioning

`/knowledge update id:5 file:[new version]` replaces a document's content without losing history — the old content is archived automatically and the version number bumps (e.g. 1.0 → 1.1). `/knowledge versions id:5` shows the full history. If the document was already approved, the update is re-indexed immediately so search reflects the change.

### Cost monitoring

`/ai costs` shows real token counts and a rough cost estimate pulled from actual API responses (not a guess) over a configurable look-back window, e.g. `/ai costs hours:168` for the last week. The dollar figure is clearly an estimate based on published rates, not your actual bill — Gemini's free tier is genuinely $0 unless you've enabled billing, regardless of what the estimate shows.

### Google Docs knowledge sync

Instead of exporting and re-uploading a document every time it changes, you can link a Google Doc directly. Edit the Doc, and UNAI picks up the change automatically — no re-uploading, ever.

**Setup, per document:**
1. In Google Docs, click **Share** → under "General access", change it to **"Anyone with the link"** → **Viewer**.
2. Copy the document's link.
3. `/sources add-google-doc link:[paste] title:"Member Guide" category:member_guide`
4. It comes in as a **pending** document, same as any upload — review it, then `/knowledge approve id:X` once.
5. From then on, UNAI checks the Doc every hour by default (configurable — see below) and automatically re-indexes it if you've edited it. `/sources sync id:X` forces an immediate check instead of waiting.

**Important security tradeoff, please read before using this for anything sensitive:** this works without any Google Cloud setup because it uses the Doc's public "anyone with the link" export — which means **anyone who has that Google Doc URL can read it directly**, completely independent of whatever Discord visibility tier (`members_only`, `government`, etc.) you set for it inside UNAI. That visibility setting only controls who the *AI* will surface the content to in Discord — it does nothing to protect the underlying Google Doc itself. This is a fine tradeoff for a Member Guide or public FAQ; it's the wrong tool for anything genuinely confidential (say, real financial records or classified military planning) — keep those as manual `.txt`/`.pdf`/`.docx` uploads instead, which never leave your control.

**Sync interval:** defaults to every 60 minutes. Change it by editing the `google_doc_sync_interval_minutes` config value directly in the database, or ask me to add a slash command for it if you'll want to change this often — I kept it out of the command surface for now to avoid it feeling like a dial you need to touch.

## How it actually decides to respond (for your own understanding)

1. Ignores bots, webhooks, DMs.
2. Checks if UNAI is enabled and the trigger mode allows this message (tagged / smart / hybrid).
3. Checks the channel is monitored (skipped if the bot was @mentioned directly).
4. A cheap classification call checks: is this actually a question, and is it on an approved topic? If not — silence.
5. Cooldowns are checked so one user or channel can't spam it.
6. It searches the FAQ and the approved knowledge base for relevant material (semantic search via embeddings).
7. It generates an answer **grounded only in what was retrieved**, and self-reports a confidence score based on how well that material actually covers the question.
8. Below your confidence threshold → it stays silent and instead posts a flag in your escalation channel, tagging the question for government follow-up. At or above threshold → it answers, with a source citation.

This matches the spec's core principle: **"Should I respond?" is always asked before "How should I respond?"**

---

## What's genuinely NOT built yet (by design, per your call on scope)

- **Live Politics & War API integration** (alliance/nation lookups, "who is @X" Discord-to-nation linking) — this is next up, by your priority call. Unlike the Banking/Audit/Legislation bots, the P&W API is real and public, so this is fully buildable now.
- Live integrations with Banking / Audit / Legislation / Activity / Election bots (Sections 47–54) — nothing exists yet to connect to. When one of those bots has a database or API, a new file goes in `src/integrations/`, and `answerEngine.js` gets a few lines to pull live data in before generating an answer. Nothing else needs to change.
- Other dynamic knowledge source types (websites, GitHub repos, Google Sheets) — the architecture (`src/knowledge/sourceManager.js` + a per-type fetch module like `googleDocsSource.js`) is built to extend to these without changing existing code; only Google Docs is implemented so far.
- PDF/DOCX/OCR for scanned documents — plain `.txt`, `.md`, `.pdf`, and `.docx` are supported; a scanned/image-only PDF with no text layer still needs OCR first (outside this build's scope).
- `/backup export` doesn't currently include knowledge sources (the Google Doc links) — only the documents themselves. Worth adding if you come to rely on several linked Docs.
- A web dashboard — everything is Discord-native for v1, per the spec's "no code editing required" principle.

---

## Troubleshooting

- **Bot shows offline:** check Railway's Deploy Logs for a crash; usually a missing/incorrect environment variable.
- **Slash commands don't show up:** re-run `npm run deploy-commands`; global registration can take up to an hour, guild-scoped (with `DISCORD_GUILD_ID` set) is instant.
- **`"This model models/... is no longer available to new users"`:** Google periodically restricts older model generations to API keys/projects that already had prior usage, pushing brand-new keys to the current generation. Set `GEMINI_MODEL=gemini-flash-lite-latest` in `.env` (the default now, so update if you're on an older copy) — it auto-updates to whichever Flash-Lite model is current instead of a hardcoded ID that can get cut off. Run `npm run list-gemini-models` to see exactly which model IDs your key can access right now if you want to pin a specific one instead.
- **`429 RESOURCE_EXHAUSTED` / quota exceeded:** you've hit Gemini's free-tier rate limit. Two different limits can trigger this: a per-minute burst limit (the bot now automatically retries once or twice with a short delay for this case) and a per-day cap. If it's the daily cap, note which model the error mentions — `gemini-flash-latest` currently resolves to a brand-new preview model Google's provisioned with only ~20 free requests/day, while `gemini-flash-lite-latest` (the default here) sits at roughly 1,000-1,500/day, which is why the Lite alias is used by default. If you're still hitting it: wait for the daily reset, enable billing on the same Google AI Studio project (cheap, instant, no waiting), or run `/ai provider openai` if you have an OpenAI key configured as a fallback.
- **`DiscordAPIError: Unknown interaction` (code 10062):** Discord invalidates a slash command's interaction token 3 seconds after creation if nothing has replied yet. A one-off occurrence (especially right after the bot starts up) is usually just network latency — try the command again. If it happens on every command, check your PC's system clock is accurate (Windows clock drift is a common, non-obvious cause) and that your network to Discord isn't heavily throttled.
- **Bot never responds automatically:** check `/ai status`, `/ai channels list`, and that you've approved at least one document or the topic/confidence bar is realistic for what you're asking.
- **"Missing Access" errors:** re-invite the bot with the `applications.commands` scope and the permissions listed in Part 1.
