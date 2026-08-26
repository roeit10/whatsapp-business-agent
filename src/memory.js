import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

// Keep the last N entries (15 exchanges) per contact. At 12 the opening of a
// normal shop conversation was already being trimmed away mid-chat. Tool call/result pairs are dropped before
// storing: they are large, they go stale within minutes (stock changes), and
// replaying them invites the model to answer from an old tool result instead of
// calling the tool again.
const MAX_TURNS = 30;

let store = {};

function load() {
  try {
    store = JSON.parse(fs.readFileSync(config.memoryFile, 'utf8'));
  } catch {
    store = {};
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(config.memoryFile), { recursive: true });
    fs.writeFileSync(config.memoryFile, JSON.stringify(store));
  } catch (err) {
    // Never let a disk problem take down an answer that already succeeded.
    console.error('[memory] כתיבה נכשלה:', err.message);
  }
}

load();

export function getHistory(chatId) {
  return store[chatId] || [];
}

export function remember(chatId, userText, assistantText) {
  const turns = [
    ...(store[chatId] || []),
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText },
  ];
  store[chatId] = turns.slice(-MAX_TURNS);
  persist();
}

/**
 * A reply the agent sends on its own initiative, with no customer message in
 * front of it — the owner's answer coming back from the group. Without this the
 * customer's next message would be read against a history that never mentions
 * the answer they just received.
 */
export function rememberAssistant(chatId, assistantText) {
  const turns = [...(store[chatId] || []), { role: 'assistant', content: assistantText }];
  store[chatId] = turns.slice(-MAX_TURNS);
  persist();
}

export function forget(chatId) {
  delete store[chatId];
  persist();
}
