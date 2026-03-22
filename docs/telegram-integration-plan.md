# Telegram Integration Plan (One Shot Template)

Lightweight, flexible Telegram support baked into the template so any One Shot can send (and optionally receive) messages without reimplementing the API.

---

## 1. Bot configuration

- **TELEGRAM_BOT_TOKEN** (required for sending/receiving) – Convex env only; never expose in client.
- **TELEGRAM_BOT_USERNAME** (optional) – Convex env for display or links (e.g. `@mybot`).
- **TELEGRAM_WEBHOOK_SECRET** (optional) – Convex env; secret used to validate incoming webhook requests (e.g. random string or token in path).

**.env.example** – Document only client-safe vars; add a comment that Telegram is configured via Convex env (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET).

---

## 2. Template structure (Convex-only)

Keep everything under `convex/` to match existing modules (resend, openai, leads). No separate `/core` folder.

```
convex/
  telegramClient.ts   # Lightweight wrapper: send message, send photo, getUpdates (fetch to Bot API)
  telegram.ts         # Convex actions: sendMessage, (optional) receive path
  http.ts             # Convex HTTP router: POST /telegram-webhook → validate, parse, store, optional reply
```

- **telegramClient.ts** – Pure Node-friendly helpers (no Convex imports). Functions: `sendMessage(token, chatId, text)`, `sendPhoto(token, chatId, photoUrl)`, `getUpdates(token, offset?)`. Use `fetch` to `https://api.telegram.org/bot<token>/...`. Return `{ ok, result?, error? }`. Minimal deps (no SDK).
- **telegram.ts** – Convex **actions** (with `"use node"`). Read `TELEGRAM_BOT_TOKEN` from `process.env`; call telegramClient; optional rate-limit by chatId (e.g. in-memory or Convex table). Expose: `sendMessage({ chatId, message, mediaUrl? })` → success/failure.
- **http.ts** – Single route for Telegram webhook. `httpAction` that: checks method POST, validates TELEGRAM_WEBHOOK_SECRET (header or query), parses JSON body (Update), stores selected fields in `events` (e.g. `eventName: "telegram_incoming"`, metadata: chatId, from, text, updateId), optionally calls internal logic to reply. Returns 200 quickly so Telegram doesn’t retry.

---

## 3. Telegram API client (telegramClient.ts)

- **sendMessage(token, chatId, text)** – `POST https://api.telegram.org/bot<token>/sendMessage` with `chat_id`, `text`. Parse JSON; return `{ ok: boolean, result?: object, error?: string }`.
- **sendPhoto(token, chatId, photoUrl)** – `sendPhoto` with `photo: photoUrl` (URL). Same return shape.
- **getUpdates(token, offset?)** – `getUpdates` with `offset`, `timeout` (e.g. 0 for polling). Return updates array; caller can persist last `update_id` for next poll.

No Telegram SDK dependency; keep the template lightweight. Error handling: map HTTP non-2xx or `ok: false` to a single error shape.

---

## 4. Convex actions (telegram.ts)

- **sendMessage** (public action)  
  - Args: `chatId: v.string()`, `message: v.string()`, `mediaUrl: v.optional(v.string())`.  
  - If no `TELEGRAM_BOT_TOKEN`, return `{ success: false, error: "Telegram not configured" }`.  
  - If `mediaUrl` provided, call `sendPhoto`; else `sendMessage`.  
  - Return `{ success: boolean, error?: string }`.

- **Optional: receive path for analytics**  
  - Internal mutation or action that writes to `events`: `eventName: "telegram_incoming"`, metadata: `{ chatId, from, text, updateId }`.  
  - Called from http webhook handler after validating request.

- **Optional: rate limiting**  
  - Table `telegramRateLimit` (e.g. `chatId`, `count`, `windowStart`) or use existing `data` table with key `telegram_rate_<chatId>`. Before sending, check count in window; if over threshold, return error. Kept minimal (e.g. 20/min per chatId).

---

## 5. Webhook vs polling

- **Webhook (recommended for production)**  
  - Convex HTTP route, e.g. `POST /telegram-webhook`.  
  - Set Telegram webhook URL to `https://<convex-deployment>.convex.site/telegram-webhook` (or your custom domain if configured).  
  - Validate requests with TELEGRAM_WEBHOOK_SECRET (e.g. `X-Telegram-Secret` header or path suffix).  
  - Parse Update, store in events, return 200.

- **Polling (optional, for PoC)**  
  - Convex action `getUpdates(offset?)` that calls telegramClient.getUpdates, then an internal mutation to store incoming messages in `events`.  
  - No http.ts required. A cron or external scheduler could call the action periodically with the last `update_id` (stored in `data` table).  
  - Template can document polling as “optional” and implement webhook first.

---

## 6. Security and safety

- **Validate webhook requests** – Require TELEGRAM_WEBHOOK_SECRET to match (header or path). Reject with 401/403 otherwise.
- **No token in client** – All Telegram usage from Convex actions only; token only in Convex env.
- **Optional rate limiting** – Per chatId (and optionally per user) to prevent abuse of send/receive.
- **Minimal logging** – Store in `events` only what’s needed: chatId, timestamp, message content (or updateId + ref to Update). No token or secrets in logs.

---

## 7. Schema / tables

- **Existing `events` table** – Reuse for incoming Telegram events: `eventName: "telegram_incoming"`, `metadata: { chatId, from, text, updateId, ... }`, `challengeId` (e.g. from env or fixed "telegram"), `sessionId` (e.g. chatId or from.id).
- **Optional: `telegramRateLimit`** – If rate limiting is added: `chatId`, `count`, `windowStart`; index by `chatId`. Or use `data` table with key `telegram_rate_<chatId>` and value `{ count, windowStart }`.

---

## 8. Usage pattern (for One Shots)

- From Convex (e.g. another action or mutation scheduler):  
  `await ctx.runAction(api.telegram.sendMessage, { chatId: "...", message: "Hello" });`  
  Optional: `mediaUrl` for images.
- From client (e.g. “Notify me on Telegram”):  
  Call `convex.action(api.telegram.sendMessage, { chatId, message })` – chatId might come from a prior step (user links bot, bot sends “Your chat ID is X” or stored in leads/data).
- Receiving: Webhook stores updates in `events`; One Shots can query or subscribe to `events` with `eventName: "telegram_incoming"` and react (e.g. reply via sendMessage).

---

## 9. Implementation order

1. **telegramClient.ts** – Implement sendMessage, sendPhoto, getUpdates with fetch; no Convex deps.
2. **telegram.ts** – Actions: sendMessage (and sendPhoto via mediaUrl); read token from env; return success/error.
3. **http.ts** – Route POST /telegram-webhook; validate secret; parse Update; store in events; return 200.
4. **.env.example** – Comment for Convex env: TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET.
5. **Optional** – Rate limiting (data or telegramRateLimit table); polling cron + getUpdates action.

---

## 10. Files to add or change

| Area | File | Purpose |
|------|------|--------|
| Client | `convex/telegramClient.ts` | sendMessage, sendPhoto, getUpdates via fetch |
| Actions | `convex/telegram.ts` | sendMessage (and optional rate limit) |
| HTTP | `convex/http.ts` | POST /telegram-webhook → validate, store in events |
| Config | `.env.example` | Document Convex env vars for Telegram |
| Schema | `convex/schema.ts` | Optional telegramRateLimit table only if needed |

---

## 11. Extensibility (later)

- Inline keyboards / reply markup – extend sendMessage args with optional `reply_markup`.
- Commands – in webhook handler, check `message.text` for `/start`, etc., and route.
- Multiple bots – second token in env (e.g. TELEGRAM_BOT_TOKEN_2) and optional botId in actions (out of scope for v1).

This keeps the template minimal while making Telegram reusable and ready for webhook or polling and future features.
