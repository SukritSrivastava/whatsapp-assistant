# WhatsApp Assistant

A personal WhatsApp assistant. It logs into a WhatsApp account for you (ideally
a **secondary/spare number**, not your main one), watches incoming messages
from everyone who texts that number, and replies on your behalf:

- Simple, low-stakes messages get an **automatic** reply, drafted in your voice.
- Anything ambiguous, important, or sensitive gets **held for your approval** —
  it messages you directly on your real WhatsApp number with a draft, and you
  reply "send", "edit: ...", or "skip".

It runs as a plain Node.js process on your own computer.

---

## ⚠️ Read this before you set it up

**This uses an unofficial library (Baileys), not WhatsApp's official Business
API.** It connects the same way WhatsApp Web does (via QR code), and it
technically violates WhatsApp's Terms of Service. For light personal use the
practical risk is generally low, but WhatsApp can restrict or ban a number for
automated behavior, especially if it sends a lot of messages quickly. That's
exactly why a **secondary number** (a spare SIM, an eSIM, a second WhatsApp-
compatible number) rather than your primary number is the safer setup, and
what this project assumes.

**It reads real people's messages and can reply as "you."** Two things worth
doing:

1. Keep "always ask me first" rules broad, especially at the start — the
   default `config/rules.json` errs toward asking rather than auto-sending.
2. Consider telling regular contacts you have an assistant helping triage
   messages. Auto-replies that read a little "off" can be more confusing if
   someone doesn't know an AI was involved.

You're fully in control of the rules — see "Customizing behavior" below.

---

## What you'll need

1. **Node.js 20+** installed on the computer that will run this 24/7.
2. **A secondary phone number that can receive WhatsApp** (a spare SIM, a
   second eSIM profile, or similar) — you'll link WhatsApp Web to it via QR
   code, the same way you'd add WhatsApp to a laptop.
3. **A Gemini API key (free)** — get one at https://aistudio.google.com/apikey
   (sign in with a Google account, click "Create API key"). Google's free
   tier requires no credit card and is generous enough for personal use.
4. **Your real personal WhatsApp number** — this is where the bot will send
   you drafts to approve and where you'll send it commands. It doesn't need
   to be linked to anything; the bot just sends normal messages to it.

---

## Setup

```bash
cd whatsapp-assistant
npm install
cp .env.example .env
```

Edit `.env`:

- `GEMINI_API_KEY` — your free Gemini API key.
- `OWNER_NUMBER` — **your real number**, digits only with country code, no
  `+` and no spaces (e.g. `919876543210` for +91 98765 43210).
- `GEMINI_MODEL` — leave as default unless you want to change models.

Start it:

```bash
npm start
```

A QR code will print in your terminal. On the **secondary phone**, open
WhatsApp → Settings → Linked Devices → Link a Device, and scan it. Once
connected you'll see `[whatsapp] connected.` in the terminal, and the bot is
live — anyone who messages that secondary number will now go through the
assistant.

Send `help` from your own WhatsApp (`OWNER_NUMBER`) to the bot's number at
any time to see available commands.

Keep the process running (see "Keeping it running 24/7" below) for it to
actually catch messages as they arrive.

---

## How it decides what to do

Every incoming message gets classified by Gemini into one of three buckets,
based on the instructions in `config/rules.json`:

- **auto** — sends a reply immediately, no approval needed, and tells you
  afterward what it sent.
- **approve** — drafts a reply and messages *you* (on `OWNER_NUMBER`) with the
  original message, the draft, and the draft's ID number, and waits for your
  command.
- **ignore** — does nothing (e.g. obvious spam).

When you get a draft message, reply from your own WhatsApp with:

| Command | What it does |
|---|---|
| `send` | sends the most recent pending draft as-is |
| `send 3` | sends draft #3 specifically |
| `edit: <text>` | sends your own text instead of the draft (most recent) |
| `edit 3: <text>` | same, but for draft #3 |
| `skip` | discards the most recent draft, no reply sent |
| `skip 3` | discards draft #3 |
| `status` | lists pending drafts and whether the bot is paused |
| `pause` | stops the bot from processing any incoming messages |
| `resume` | undoes `pause` |
| `help` | shows this command list |

---

## Customizing behavior

Open `config/rules.json` — you can edit and save it while the bot is running,
it re-reads the file on every incoming message, no restart needed.

- `persona` — describes your voice/tone. Rewrite this in your own words so
  drafted replies actually sound like you.
- `autoReplyGuidance` — plain-English description of what's safe to send
  automatically. Keep this narrow at first.
- `alwaysAskGuidance` — what should always be held for your approval.
- `ignoreGuidance` — what to silently ignore (spam, etc).
- `customFacts` — short standing facts the assistant can use confidently
  (e.g. "I'm usually free after 7pm on weekdays"). These make more messages
  eligible for auto-reply without guessing.
- `groupChatsEnabled` — `false` by default. Set to `true` only if you
  actually want it acting inside group chats too (higher risk of an odd
  auto-reply being visible to lots of people at once).

Since the classification is done by Gemini reading these instructions in
plain English (not rigid keyword rules), you can be as specific as you like —
e.g. add a line like `"Messages from my landlord — always ask me first, don't
improvise anything about rent or the apartment."`

---

## Keeping it running 24/7

Running `npm start` in a terminal only lasts as long as that terminal stays
open. To keep it running in the background reliably, use a process manager
like [pm2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start src/index.js --name whatsapp-assistant
pm2 save
pm2 startup   # follow the printed instructions to auto-start on boot
```

Useful pm2 commands:

```bash
pm2 logs whatsapp-assistant   # view live logs
pm2 restart whatsapp-assistant
pm2 stop whatsapp-assistant
```

---

## Data & privacy

Everything is stored locally in the `data/` folder, which is git-ignored:

- `data/auth/` — your WhatsApp Web session credentials. Treat this like a
  password; anyone with these files can access that WhatsApp account.
- `data/history.json` — the last ~20 messages per chat, used as context for
  drafting replies.
- `data/drafts.json` — pending drafts waiting for your approval.
- `data/state.json` — whether the bot is currently paused.

To fully reset (e.g. to re-link a different number), stop the bot and delete
the whole `data/` folder, then restart.

---

## Limitations (current version)

- Only handles plain text messages (and captions on images/videos) — it
  won't transcribe voice notes, describe images, or open documents.
- One incoming message = one Gemini call; it doesn't batch multiple rapid
  messages from the same person before replying.
- No built-in rate limiting beyond what WhatsApp itself enforces — very high
  message volume could still draw WhatsApp's attention. Fine for normal
  personal use.
- Single owner only — it's built around one `OWNER_NUMBER` approving drafts.
