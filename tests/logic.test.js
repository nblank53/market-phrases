import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalize, checkTyped, answerVariants, review, isDue, pickSession, pickDistractors,
  mastery, boxCounts, weakest, streak, dayKey, speakableText, BOX_INTERVAL_DAYS, MAX_BOX,
} from '../logic.js';

const DAY = 86400000;
const DATA = JSON.parse(readFileSync(new URL('../phrases.json', import.meta.url), 'utf8'));
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------- Normalization ----------

test('normalize strips accents, case, punctuation; ß -> ss', () => {
  assert.equal(normalize("S'il vous plaît"), 's il vous plait');
  assert.equal(normalize('Combien ça coûte ?'), 'combien ca coute');
  assert.equal(normalize('Grüezi!'), 'gruezi');
  assert.equal(normalize('Straße'), 'strasse');
  assert.equal(normalize('  Un billet pour..., s’il  vous plaît '), 'un billet pour s il vous plait');
});

test('typed answers are lenient on accents, punctuation, case and spacing', () => {
  assert.ok(checkTyped('sil vous plait', "S'il vous plaît").exact);
  assert.ok(checkTyped("s'il vous plait", "S'il vous plaît").exact);
  assert.ok(checkTyped('combien ca coute', 'Combien ça coûte ?').exact);
  assert.ok(checkTyped('PARLEZ VOUS ANGLAIS', 'Parlez-vous anglais ?').exact);
  assert.ok(checkTyped('dove il bagno', "Dov'è il bagno?").exact);
  assert.ok(checkTyped('wo ist', 'Wo ist...?').exact);
});

test('German umlauts accept both plain vowel and ae/oe/ue spellings', () => {
  assert.ok(checkTyped('einen gluhwein bitte', 'Einen Glühwein, bitte').exact);
  assert.ok(checkTyped('einen gluehwein bitte', 'Einen Glühwein, bitte').exact);
  assert.ok(checkTyped('koennen sie langsamer sprechen', 'Können Sie langsamer sprechen?').exact);
});

test('optional gender endings are accepted either way', () => {
  assert.ok(checkTyped('enchante', 'Enchanté(e)').exact);
  assert.ok(checkTyped('enchantee', 'Enchanté(e)').exact);
  assert.ok(checkTyped('sono allergico a', 'Sono allergico/a a...').exact);
  assert.ok(checkTyped('sono allergica a', 'Sono allergico/a a...').exact);
  assert.ok(checkTyped('mi sono persa', 'Mi sono perso/a').exact);
  assert.ok(answerVariants('Je suis végétarien(ne)').includes('jesuisvegetarienne'));
});

test('small typos pass on long phrases, but not on short ones or wrong answers', () => {
  const r = checkTyped('je ne comprend pas', 'Je ne comprends pas');
  assert.equal(r.correct, true);
  assert.equal(r.exact, false);
  assert.equal(checkTyped('mercy', 'Merci').correct, false);
  assert.equal(checkTyped('bonsoir', 'Bonjour').correct, false);
  assert.equal(checkTyped('', 'Bonjour').correct, false);
  assert.equal(checkTyped('grazie', 'Prego').correct, false);
});

// ---------- Leitner ----------

test('correct answers move up one box, capped at 5', () => {
  const now = 1_000_000;
  let c = review(undefined, true, now);
  assert.equal(c.box, 1);
  for (let i = 0; i < 10; i++) c = review(c, true, now);
  assert.equal(c.box, MAX_BOX);
  assert.equal(c.due, now + BOX_INTERVAL_DAYS[5] * DAY);
});

test('a miss drops the card to box 1 and makes it due immediately', () => {
  const now = 5_000_000;
  let c = review(review(review(undefined, true, 0), true, 0), true, 0);
  assert.equal(c.box, 3);
  c = review(c, false, now);
  assert.equal(c.box, 1);
  assert.equal(c.due, now);
  assert.ok(isDue(c, now));
  assert.equal(c.wrong, 1);
  assert.equal(c.right, 3);
  assert.equal(c.seen, 4);
});

test('higher boxes wait longer before coming back', () => {
  const now = 0;
  let c = review(undefined, true, now); // box 1
  c = review(c, true, now); // box 2
  assert.equal(c.box, 2);
  assert.ok(!isDue(c, now + DAY / 2));
  assert.ok(isDue(c, now + DAY));
  const intervals = [1, 2, 3, 4, 5].map((b) => BOX_INTERVAL_DAYS[b]);
  assert.deepEqual(intervals, [...intervals].sort((a, b) => a - b));
});

test('review never mutates the stored card', () => {
  const c = { box: 2, due: 0, seen: 1, right: 1, wrong: 0, last: 0 };
  const frozen = JSON.stringify(c);
  review(c, false, 10);
  assert.equal(JSON.stringify(c), frozen);
});

test('pickSession puts due reviews first, then new must-know phrases, skipping not-due ones', () => {
  const now = 100 * DAY;
  const phrases = [
    { id: 'a', priority: 2 }, { id: 'b', priority: 1 }, { id: 'c', priority: 1 },
    { id: 'd', priority: 1 }, { id: 'e', priority: 3 },
  ];
  const progress = {
    a: { box: 1, due: now - 1 },     // due
    c: { box: 5, due: now + 10 * DAY }, // mastered, not due
    d: { box: 3, due: now - DAY },   // due
  };
  const ids = pickSession(phrases, progress, 3, now, seeded(7)).map((p) => p.id).sort();
  assert.deepEqual(ids, ['a', 'b', 'd']);
  // With room for everything, not-due cards fill in last.
  assert.equal(pickSession(phrases, progress, 10, now, seeded(7)).length, 5);
});

test('progress is keyed by id, so new phrases appear as new without resetting old ones', () => {
  const progress = { 'fr-001': { box: 4, due: 0, seen: 4, right: 4, wrong: 0 } };
  const extended = [...DATA.phrases, { id: 'fr-999', country: 'fr', category: 'greetings', priority: 1, native: 'Coucou', english: 'Hi there' }];
  const counts = boxCounts(extended, progress);
  assert.equal(counts.mastered, 1);
  assert.equal(counts.new, extended.length - 1);
});

// ---------- Distractors / stats ----------

test('distractors are unique, exclude the answer, and native options stay in the same language', () => {
  const rng = seeded(3);
  for (const target of DATA.phrases) {
    for (const field of ['english', 'native']) {
      const ds = pickDistractors(target, DATA.phrases, field, 3, rng);
      assert.equal(ds.length, 3, `${target.id} ${field}`);
      const keys = new Set([target, ...ds].map((p) => normalize(p[field]).replace(/ /g, '')));
      assert.equal(keys.size, 4, `duplicate option for ${target.id} ${field}`);
      if (field === 'native') assert.ok(ds.every((d) => d.country === target.country));
    }
  }
});

test('mastery, weakest and streak', () => {
  const ps = [{ id: 'x' }, { id: 'y' }];
  const progress = { x: { box: 5, seen: 3, wrong: 0 }, y: { box: 1, seen: 4, wrong: 3 } };
  assert.equal(mastery(ps, progress), 6 / 10);
  assert.deepEqual(weakest(ps, progress).map((p) => p.id), ['y']);

  const now = new Date(2026, 11, 10, 12).getTime();
  const d = (n) => dayKey(now - n * DAY);
  assert.equal(streak([d(0), d(1), d(2), d(5)], now), 3);
  assert.equal(streak([d(1), d(2)], now), 2, 'today not practiced yet still keeps streak');
  assert.equal(streak([d(2), d(3)], now), 0);
  assert.equal(streak([], now), 0);
});

test('speakableText cleans up display-only markup', () => {
  assert.equal(speakableText('Je voudrais...'), 'Je voudrais');
  assert.equal(speakableText('Oui / Non'), 'Oui, Non');
  assert.equal(speakableText('Enchanté(e)'), 'Enchanté');
  assert.equal(speakableText('Sono allergico/a a...'), 'Sono allergico a');
  assert.equal(speakableText('Parlez-vous anglais ?'), 'Parlez-vous anglais?');
});

test('phrases.json is well formed', () => {
  const ids = new Set();
  const codes = new Set(DATA.meta.countries.map((c) => c.code));
  for (const p of DATA.phrases) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.ok(codes.has(p.country), `${p.id} country`);
    assert.ok(DATA.meta.categories.includes(p.category), `${p.id} category`);
    assert.ok([1, 2, 3].includes(p.priority), `${p.id} priority`);
    for (const f of ['native', 'english', 'phonetic']) assert.ok(p[f], `${p.id} ${f}`);
  }
});
