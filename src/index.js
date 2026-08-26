require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { connectWhatsApp } = require('./whatsapp');
const { decideReply } = require('./llm');
const store = require('./store');

const RULES_PATH = path.join(__dirname, '..', 'config', 'rules.json');

if (!process.env.GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!process.env.OWNER_NUMBER) {
  console.error('Missing OWNER_NUMBER. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const OWNER_JID = `${process.env.OWNER_NUMBER}@s.whatsapp.net`;

// Re-read rules.json on every message so you can edit rules while the bot is
// running, without restarting it.
function loadRules() {
  const raw = fs.readFileSync(RULES_PATH, 'utf8');
  return JSON.parse(raw);
}

function getText(msg) {
  const m = msg.message;
  if (!m) return null;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  return null;
}

function formatDraftMessage(draft, reason) {
  return [
    `📩 Message from *${draft.contactName}*:`,
    `"${draft.originalText}"`,
    '',
    `💬 Suggested reply:`,
    `"${draft.draftReply}"`,
    reason ? `\n(why it's asking: ${reason})` : '',
    '',
    `Reply here with:`,
    `• "send" — send it as-is`,
    `• "edit: <new text>" — send your edited version instead`,
    `• "skip" — don't reply to them`,
    `[draft #${draft.id}]`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function notifyOwner(sock, text) {
  await sock.sendMessage(OWNER_JID, { text });
}

async function handleContactMessage(sock, remoteJid, contactName, text) {
  if (store.isPaused()) return;

  const rules = loadRules();
  const isGroup = remoteJid.endsWith('@g.us');
  if (isGroup && !rules.groupChatsEnabled) return;

  const history = store.getHistory(remoteJid);
  store.appendHistory(remoteJid, { role: 'them', text });

  let decision;
  try {
    console.log('[debug] calling Gemini for message from', contactName, '...');
    decision = await decideReply({ rules, contactName, history, incomingText: text });
    console.log('[debug] Gemini responded:', decision);
  } catch (err) {
    console.error('[llm] decision failed:', err);
    await notifyOwner(sock, `⚠️ Couldn't process a message from ${contactName} (Gemini API error). Original: "${text}"`);
    return;
  }

  if (decision.classification === 'ignore') {
    console.log(`[ignore] ${contactName}: ${text} (${decision.reason})`);
    return;
  }

  // Approval step is disabled — anything that isn't "ignore" gets sent
  // straight away. (classification is still logged so you can see what
  // Gemini was thinking.)
  await sock.sendMessage(remoteJid, { text: decision.reply });
  store.appendHistory(remoteJid, { role: 'me', text: decision.reply });
  await notifyOwner(
    sock,
    `🤖 Replied to *${contactName}*:\n"${decision.reply}"\n(reason: ${decision.reason})`
  );
}

function resolveDraft(explicitId) {
  if (explicitId) return store.getDraft(Number(explicitId));
  return store.getLatestDraft();
}

async function handleOwnerCommand(sock, text) {
  const trimmed = text.trim();

  if (/^help$/i.test(trimmed)) {
    await notifyOwner(
      sock,
      [
        'Commands:',
        '• send [id] — send the draft (latest if no id given)',
        '• edit [id]: <text> — send your edited text instead of the draft',
        '• skip [id] — discard the draft, don\'t reply',
        '• status — show pending drafts and pause state',
        '• pause / resume — stop/start auto-handling of incoming messages',
      ].join('\n')
    );
    return;
  }

  if (/^status$/i.test(trimmed)) {
    const pending = store.listPendingDrafts();
    const lines = [`Bot is ${store.isPaused() ? 'PAUSED' : 'running'}.`];
    if (pending.length === 0) {
      lines.push('No pending drafts.');
    } else {
      lines.push(`${pending.length} pending draft(s):`);
      for (const d of pending) {
        lines.push(`#${d.id} — ${d.contactName}: "${d.draftReply}"`);
      }
    }
    await notifyOwner(sock, lines.join('\n'));
    return;
  }

  if (/^pause$/i.test(trimmed)) {
    store.setPaused(true);
    await notifyOwner(sock, '⏸️ Paused. I will not reply to anyone until you send "resume".');
    return;
  }

  if (/^resume$/i.test(trimmed)) {
    store.setPaused(false);
    await notifyOwner(sock, '▶️ Resumed.');
    return;
  }

  let match = trimmed.match(/^(send|✅)\s*(\d+)?$/i);
  if (match) {
    const draft = resolveDraft(match[2]);
    if (!draft) {
      await notifyOwner(sock, 'No matching pending draft.');
      return;
    }
    await sock.sendMessage(draft.chatJid, { text: draft.draftReply });
    store.appendHistory(draft.chatJid, { role: 'me', text: draft.draftReply });
    store.removeDraft(draft.id);
    await notifyOwner(sock, `✅ Sent to ${draft.contactName}.`);
    return;
  }

  match = trimmed.match(/^(skip|❌|no)\s*(\d+)?$/i);
  if (match) {
    const draft = resolveDraft(match[2]);
    if (!draft) {
      await notifyOwner(sock, 'No matching pending draft.');
      return;
    }
    store.removeDraft(draft.id);
    await notifyOwner(sock, `❌ Skipped reply to ${draft.contactName}.`);
    return;
  }

  match = trimmed.match(/^edit(?:\s+(\d+))?\s*:\s*([\s\S]+)$/i);
  if (match) {
    const [, id, newText] = match;
    const draft = resolveDraft(id);
    if (!draft) {
      await notifyOwner(sock, 'No matching pending draft.');
      return;
    }
    await sock.sendMessage(draft.chatJid, { text: newText.trim() });
    store.appendHistory(draft.chatJid, { role: 'me', text: newText.trim() });
    store.removeDraft(draft.id);
    await notifyOwner(sock, `✅ Sent your edited reply to ${draft.contactName}.`);
    return;
  }

  await notifyOwner(sock, `Didn't recognize that command. Reply "help" to see available commands.`);
}

async function onMessage(sock, msg) {
  if (msg.key.fromMe) return; // ignore our own sent messages (avoid loops)
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid || remoteJid === 'status@broadcast') return;

  const text = getText(msg);
  if (!text) return; // skip non-text messages (images/stickers/etc.) for now

  if (remoteJid === OWNER_JID) {
    await handleOwnerCommand(sock, text);
    return;
  }

  const contactName = msg.pushName || remoteJid.split('@')[0];
  await handleContactMessage(sock, remoteJid, contactName, text);
}

async function main() {
  console.log('[startup] connecting to WhatsApp...');
  await connectWhatsApp({ onMessage });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});