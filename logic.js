// Pure, DOM-free logic so it can be unit tested with `node --test`.

// ---------- Answer normalization ----------

const GERMAN_TRANSLIT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue' };

/** Lowercase, strip accents and punctuation, collapse whitespace. ß -> ss. */
export function normalize(text) {
  return String(text)
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Same as normalize but ignores spaces too ("s il vous plait" == "sil vous plait"). */
export function squash(text) {
  return normalize(text).replace(/ /g, '');
}

/**
 * All acceptable spellings of a native phrase:
 *  - "Enchanté(e)"          -> "Enchanté", "Enchantée"
 *  - "Sono allergico/a a..." -> "Sono allergico a", "Sono allergica a" (and original)
 *  - "Glühwein"             -> also "Gluehwein"
 */
export function answerVariants(native) {
  const base = String(native);
  const out = new Set([base]);
  out.add(base.replace(/\([^)]*\)/g, ''));       // drop optional "(e)"
  out.add(base.replace(/\(([^)]*)\)/g, '$1'));   // inline optional "(e)"
  // unspaced slash suffix: allergico/a -> allergico | allergica
  out.add(base.replace(/(\p{L}+)\/(\p{L}+)/gu, '$1'));
  out.add(base.replace(/(\p{L}+)\/(\p{L}+)/gu, (m, a, b) => a.slice(0, a.length - b.length) + b));
  for (const v of [...out]) {
    if (/[äöüÄÖÜ]/.test(v)) out.add(v.replace(/[äöüÄÖÜ]/g, (c) => GERMAN_TRANSLIT[c]));
  }
  return [...new Set([...out].map(squash))].filter(Boolean);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Check a typed answer against the native phrase.
 * Returns { correct, exact }: exact = matched after normalization,
 * correct && !exact = a small typo we still accept (1 typo per ~8 letters).
 */
export function checkTyped(input, native) {
  const given = squash(input);
  if (!given) return { correct: false, exact: false };
  const variants = answerVariants(native);
  if (variants.includes(given)) return { correct: true, exact: true };
  for (const v of variants) {
    const allowed = Math.floor(v.length / 8);
    if (allowed > 0 && levenshtein(given, v) <= allowed) return { correct: true, exact: false };
  }
  return { correct: false, exact: false };
}

// ---------- Leitner scheduling ----------

export const MAX_BOX = 5;
const DAY = 24 * 60 * 60 * 1000;
/** Days until a card in each box is due again. Missed cards go to box 1 = due now. */
export const BOX_INTERVAL_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };

export function newCard() {
  return { box: 0, due: 0, seen: 0, right: 0, wrong: 0, last: 0 };
}

/** Returns a NEW card record after an answer. */
export function review(card, correct, now = Date.now()) {
  const c = { ...newCard(), ...(card || {}) };
  c.box = correct ? Math.min(MAX_BOX, Math.max(1, c.box + 1)) : 1;
  c.due = now + BOX_INTERVAL_DAYS[c.box] * DAY;
  c.seen += 1;
  c.last = now;
  if (correct) c.right += 1; else c.wrong += 1;
  return c;
}

export function isDue(card, now = Date.now()) {
  return !card || card.box === 0 || card.due <= now;
}

/**
 * Choose up to n phrases for a quiz session.
 * Order: due reviews (lowest box first, oldest due first), then new phrases
 * (must-know first), then not-yet-due phrases (lowest box first) to fill.
 */
export function pickSession(phrases, progress, n, now = Date.now(), rng = Math.random) {
  const tagged = phrases.map((p) => ({ p, c: progress[p.id], r: rng() }));
  const reviews = tagged.filter((t) => t.c && t.c.box > 0 && t.c.due <= now)
    .sort((a, b) => a.c.box - b.c.box || a.c.due - b.c.due || a.r - b.r);
  const fresh = tagged.filter((t) => !t.c || t.c.box === 0)
    .sort((a, b) => a.p.priority - b.p.priority || a.r - b.r);
  const later = tagged.filter((t) => t.c && t.c.box > 0 && t.c.due > now)
    .sort((a, b) => a.c.box - b.c.box || a.c.due - b.c.due || a.r - b.r);
  const ordered = [...reviews, ...fresh, ...later].slice(0, n).map((t) => t.p);
  return shuffle(ordered, rng);
}

// ---------- Multiple-choice distractors ----------

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick k wrong options for `target`, comparing on `field` ("english" or "native").
 * Prefers same country + same category, then same country. Native-text options
 * only ever come from the same country so the language doesn't give it away.
 */
export function pickDistractors(target, pool, field, k = 3, rng = Math.random) {
  const seen = new Set([squash(target[field])]);
  const tiers = [[], [], []];
  for (const p of shuffle(pool, rng)) {
    if (p.id === target.id) continue;
    const sameCountry = p.country === target.country;
    if (field === 'native' && !sameCountry) continue;
    const tier = sameCountry && p.category === target.category ? 0 : sameCountry ? 1 : 2;
    tiers[tier].push(p);
  }
  const out = [];
  for (const p of tiers.flat()) {
    const key = squash(p[field]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length === k) break;
  }
  return out;
}

// ---------- Progress / stats ----------

export function mastery(phrases, progress) {
  if (!phrases.length) return 0;
  const total = phrases.reduce((s, p) => s + ((progress[p.id] && progress[p.id].box) || 0), 0);
  return total / (phrases.length * MAX_BOX);
}

export function boxCounts(phrases, progress) {
  const counts = { new: 0, learning: 0, mastered: 0 };
  for (const p of phrases) {
    const box = (progress[p.id] && progress[p.id].box) || 0;
    if (box === 0) counts.new++;
    else if (box >= 4) counts.mastered++;
    else counts.learning++;
  }
  return counts;
}

/** Seen phrases sorted weakest first: lowest box, then most misses, then miss rate. */
export function weakest(phrases, progress, n = 10) {
  return phrases
    .filter((p) => progress[p.id] && progress[p.id].seen > 0 && progress[p.id].wrong > 0)
    .sort((a, b) => {
      const A = progress[a.id], B = progress[b.id];
      return A.box - B.box || B.wrong - A.wrong || B.wrong / B.seen - A.wrong / A.seen;
    })
    .slice(0, n);
}

export function dayKey(date) {
  const d = new Date(date);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Consecutive practice days ending today (or yesterday, if today isn't done yet). */
export function streak(dayKeys, now = Date.now()) {
  const days = new Set(dayKeys);
  let cursor = new Date(now);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (days.has(dayKey(cursor))) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

// ---------- Speech helpers ----------

/** Text to send to speechSynthesis: drop "(e)", ellipses, and turn "a / b" into "a, b". */
export function speakableText(native) {
  return String(native)
    .replace(/\([^)]*\)/g, '')
    .replace(/(\p{L}+)\/\p{L}+/gu, '$1')
    .replace(/\s*\/\s*/g, ', ')
    .replace(/\.{2,}|…/g, ' ')
    .replace(/\s+([?!])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
