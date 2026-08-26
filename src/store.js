// Tiny JSON-file-backed store. This is a personal single-process bot, so we
// don't need a real database — just something simple, inspectable, and easy
// to hand-edit or back up.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const DRAFTS_FILE = path.join(DATA_DIR, 'drafts.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const MAX_HISTORY_PER_CHAT = 20;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[store] failed to read ${file}, using fallback:`, err.message);
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataDir();
  // write to a temp file then rename, so a crash mid-write can't corrupt the file
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// ---------- conversation history ----------
// { [chatJid]: [{ role: 'them'|'me', text, ts }, ...] }

function loadHistory() {
  return readJson(HISTORY_FILE, {});
}

function appendHistory(chatJid, entry) {
  const history = loadHistory();
  if (!history[chatJid]) history[chatJid] = [];
  history[chatJid].push({ ...entry, ts: Date.now() });
  if (history[chatJid].length > MAX_HISTORY_PER_CHAT) {
    history[chatJid] = history[chatJid].slice(-MAX_HISTORY_PER_CHAT);
  }
  writeJson(HISTORY_FILE, history);
  return history[chatJid];
}

function getHistory(chatJid) {
  const history = loadHistory();
  return history[chatJid] || [];
}

// ---------- pending drafts ----------
// { nextId: number, items: { [id]: { id, chatJid, contactName, originalText, draftReply, createdAt } } }

function loadDrafts() {
  return readJson(DRAFTS_FILE, { nextId: 1, items: {} });
}

function saveDraft({ chatJid, contactName, originalText, draftReply }) {
  const drafts = loadDrafts();
  const id = drafts.nextId;
  drafts.items[id] = {
    id,
    chatJid,
    contactName,
    originalText,
    draftReply,
    createdAt: Date.now(),
  };
  drafts.nextId += 1;
  writeJson(DRAFTS_FILE, drafts);
  return drafts.items[id];
}

function getDraft(id) {
  const drafts = loadDrafts();
  return drafts.items[id] || null;
}

function getLatestDraft() {
  const drafts = loadDrafts();
  const ids = Object.keys(drafts.items).map(Number).sort((a, b) => b - a);
  if (ids.length === 0) return null;
  return drafts.items[ids[0]];
}

function listPendingDrafts() {
  const drafts = loadDrafts();
  return Object.values(drafts.items).sort((a, b) => a.id - b.id);
}

function removeDraft(id) {
  const drafts = loadDrafts();
  delete drafts.items[id];
  writeJson(DRAFTS_FILE, drafts);
}

function updateDraftReply(id, newReply) {
  const drafts = loadDrafts();
  if (drafts.items[id]) {
    drafts.items[id].draftReply = newReply;
    writeJson(DRAFTS_FILE, drafts);
  }
  return drafts.items[id] || null;
}

// ---------- bot state (paused/resumed etc.) ----------

function loadState() {
  return readJson(STATE_FILE, { paused: false });
}

function saveState(state) {
  writeJson(STATE_FILE, state);
}

function isPaused() {
  return !!loadState().paused;
}

function setPaused(paused) {
  const state = loadState();
  state.paused = paused;
  saveState(state);
}

module.exports = {
  appendHistory,
  getHistory,
  saveDraft,
  getDraft,
  getLatestDraft,
  listPendingDrafts,
  removeDraft,
  updateDraftReply,
  isPaused,
  setPaused,
};
