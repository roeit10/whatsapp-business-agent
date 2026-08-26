import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import { norm, similarity } from './text.js';

/**
 * Questions the agent handed to the owner and is still waiting on.
 * Persisted because the answer usually arrives minutes or hours later, quite
 * possibly after a redeploy — an in-memory map would drop the customer.
 */
const MAX_TICKETS = 300;

// Nobody answers a three-day-old question and still helps that customer. Old
// open tickets stop competing for a match instead of hanging around forever.
const OPEN_TTL_HOURS = 72;

const SAME_QUESTION_THRESHOLD = 0.72;

let store = { nextId: 1, tickets: [] };

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(config.ticketsFile, 'utf8'));
    if (parsed && Array.isArray(parsed.tickets)) store = parsed;
  } catch {
    store = { nextId: 1, tickets: [] };
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(config.ticketsFile), { recursive: true });
    fs.writeFileSync(config.ticketsFile, JSON.stringify(store, null, 1));
  } catch (err) {
    console.error('[tickets] כתיבה נכשלה:', err.message);
  }
}

load();

const isFresh = (t) =>
  Date.now() - new Date(t.createdAt).getTime() < OPEN_TTL_HOURS * 3600 * 1000;

export function openTickets() {
  return store.tickets.filter((t) => t.status === 'open' && isFresh(t));
}

export function create({ chatId, customerName, question, customerText }) {
  const ticket = {
    id: store.nextId,
    chatId,
    customerName: customerName || '',
    question,
    customerText,
    groupMessageId: null,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  store.nextId += 1;
  store.tickets.push(ticket);
  store.tickets = store.tickets.slice(-MAX_TICKETS);
  persist();
  return ticket;
}

/** The id of the group message that carries this question, used to match replies. */
export function attachGroupMessage(id, groupMessageId) {
  const t = store.tickets.find((x) => x.id === id);
  if (!t) return;
  t.groupMessageId = groupMessageId;
  persist();
}

export function byId(id) {
  return store.tickets.find((t) => t.id === Number(id)) || null;
}

export function byGroupMessageId(groupMessageId) {
  if (!groupMessageId) return null;
  return store.tickets.find((t) => t.groupMessageId === groupMessageId) || null;
}

/**
 * An open ticket from the same customer asking the same thing. A customer who
 * repeats the question while waiting should not ping the owner twice.
 */
export function findDuplicate(chatId, question) {
  const key = norm(question);
  return (
    openTickets().find(
      (t) => t.chatId === chatId && similarity(key, norm(t.question)) >= SAME_QUESTION_THRESHOLD
    ) || null
  );
}

export function close(id, { answer, reply }) {
  const t = byId(id);
  if (!t) return null;
  t.status = 'answered';
  t.answer = answer;
  t.reply = reply;
  t.answeredAt = new Date().toISOString();
  persist();
  return t;
}
