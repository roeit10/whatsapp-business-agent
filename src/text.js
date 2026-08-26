/**
 * Text comparison shared by the catalogue search and the learned-answers store.
 * Both need to decide whether two Hebrew strings are "the same thing typed
 * differently", and neither can import the other without a cycle.
 */

/**
 * Customers and spreadsheets never spell units the same way: "2 קילו" vs "2 קג",
 * ק"ג with a quote vs without. Fold them onto one form before comparing, or every
 * size-qualified question misses.
 */
export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/["'׳״]/g, '')
    .replace(/\bקילוגרם\b|\bקילו\b|\bקג\b|\bkg\b/g, 'קג')
    .replace(/\bליטרים\b|\bליטר\b/g, 'ליטר')
    .replace(/\s+/g, ' ')
    .trim();

/** Character bigrams, for comparing words that are close but not identical. */
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

function dice(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return (2 * shared) / (A.size + B.size);
}

/** Normalised edit distance, 0 to 1. */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/**
 * Customers mangle brand names constantly, and the two measures fail on
 * different shapes. Bigrams handle inserted/dropped letters well but collapse
 * when two characters change: "הקרנה" against "אקאנה" scores 0.25 on bigrams
 * and 0.6 on edit distance, because only two of five letters differ. Taking the
 * better of the two catches both kinds of typo.
 */
export function similarity(a, b) {
  if (a === b) return 1;
  return Math.max(dice(a, b), levenshtein(a, b));
}
