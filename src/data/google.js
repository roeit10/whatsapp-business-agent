import config from '../config.js';

// Google's /export endpoints serve link-shared files with no credentials at all.
// The official APIs (docs.googleapis.com, sheets.googleapis.com) return 401 even
// for a public file, so this is the only no-auth path — and it is read-only.
// Writing back always needs credentials; see the WRITING section of the README.
const DOC_EXPORT = (id) => `https://docs.google.com/document/d/${id}/export?format=txt`;
const SHEET_EXPORT = (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;

const cache = new Map();

async function fetchCached(url) {
  const hit = cache.get(url);
  const now = Date.now();
  if (hit && now - hit.at < config.data.cacheSeconds * 1000) return hit.body;

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(
      `Google returned ${res.status} for ${url}. ` +
        'ודאו שהקובץ משותף ב"כל מי שיש לו את הקישור" ושה-ID נכון.'
    );
  }
  // Google prefixes exports with a UTF-8 BOM, which otherwise ends up glued to
  // the first header cell and breaks every lookup on that column.
  const body = (await res.text()).replace(/^﻿/, '');
  cache.set(url, { at: now, body });
  return body;
}

export function getKnowledgeText() {
  return fetchCached(DOC_EXPORT(config.data.knowledgeDocId));
}

/**
 * Minimal RFC-4180 CSV parser.
 * Hand-rolled because the orders sheet has quoted fields containing commas
 * ("מוצר א, מוצר ב") — a naive split(',') silently shifts every later column.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (!header) return [];
  return body.map((r) =>
    Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()]))
  );
}

export async function getSheetRows(sheetId) {
  return parseCsv(await fetchCached(SHEET_EXPORT(sheetId)));
}
