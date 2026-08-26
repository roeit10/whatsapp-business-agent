import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import { norm, similarity } from './text.js';

/**
 * Where answers from the WhatsApp group are kept.
 *
 * The default is a local JSON file rather than the Google Doc, because the doc
 * is read through the credential-free /export path — which is read-only by
 * design (see CLAUDE.md). The file is *appended* to whatever the doc says, so
 * the owner keeps editing the doc by hand and nothing is overwritten. It lives
 * next to the conversation memory, so the Railway Volume covers it.
 *
 * **This file is the seam.** A business whose knowledge base is somewhere else
 * and writable — Notion, Airtable, a CRM, a database — swaps the two exported
 * functions here and nothing else in the codebase changes: `addFact` stores one
 * fact, `knowledgeAddendum` returns the text appended to the `get_shop_info`
 * tool result. Ask the owner where their knowledge actually lives before
 * assuming this default; see the onboarding rule in CLAUDE.md.
 */
const MAX_ENTRIES = 200;

// Above this, a new question is treated as a repeat of an old one and replaces
// it. Lower than the catalogue threshold on purpose: two phrasings of the same
// policy question share far fewer characters than two spellings of one brand.
const DUPLICATE_THRESHOLD = 0.72;

let entries = [];

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(config.learnedFile, 'utf8'));
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    entries = [];
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(config.learnedFile), { recursive: true });
    fs.writeFileSync(config.learnedFile, JSON.stringify(entries, null, 1));
  } catch (err) {
    // A disk problem must not lose the answer the customer is already getting.
    console.error('[knowledge] כתיבה נכשלה:', err.message);
  }
}

load();

/**
 * Store one fact the owner supplied. A later answer to the same question wins:
 * prices and policies change, and two contradicting lines in the knowledge base
 * are worse than a stale one.
 */
export function addFact({ question, fact }) {
  const clean = String(fact || '').trim();
  if (!clean) return null;

  const key = norm(question);
  const idx = entries.findIndex((e) => similarity(key, norm(e.question)) >= DUPLICATE_THRESHOLD);
  const entry = {
    question: String(question || '').trim(),
    fact: clean,
    date: new Date().toISOString().slice(0, 10),
  };

  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);

  entries = entries.slice(-MAX_ENTRIES);
  persist();
  return entry;
}

/** Rendered block appended to the shop-info tool result. Empty when nothing was learned yet. */
export function knowledgeAddendum() {
  if (!entries.length) return '';
  return (
    '\n\n## מידע נוסף שהתקבל ישירות מבעל העסק\n' +
    'התשובות האלה נמסרו על ידי בעל העסק ומחייבות בדיוק כמו המסמך שמעליהן.\n' +
    entries.map((e) => `- ${e.fact}  (${e.date})`).join('\n')
  );
}

export function allFacts() {
  return entries.slice();
}
