import * as L from './logic.js';

// ---------- Storage ----------
const KEYS = { settings: 'mp.settings', progress: 'mp.progress', days: 'mp.days', theme: 'mp.theme' };
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode etc. */ }
  },
};

let DATA = null;
let COUNTRY = {};
let settings = { country: 'all', category: 'all', priority: 'all', length: 10, ...store.get(KEYS.settings, {}) };
let progress = store.get(KEYS.progress, {});
let days = store.get(KEYS.days, []);
let keyHandler = null;
let quiz = null;
let learn = null;
let tripState = { country: null, region: 'de' };
let progressCountry = 'all';

const $view = document.getElementById('view');
const saveSettings = () => store.set(KEYS.settings, settings);
const saveProgress = () => store.set(KEYS.progress, progress);

// ---------- Helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CATEGORY_LABELS = {
  greetings: 'Greetings', essentials: 'Essentials', christmas_market: 'Christmas market',
  food_drink: 'Food & drink', transport_directions: 'Transport & directions', lodging: 'Lodging',
  emergency: 'Emergency', numbers: 'Numbers',
};
const catLabel = (c) => CATEGORY_LABELS[c] || c.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

const EMERGENCY_LABELS = {
  all_emergencies_eu: 'All emergencies', all_emergencies: 'All emergencies', medical_samu: 'Medical (SAMU)',
  police: 'Police', fire: 'Fire', ambulance: 'Ambulance', police_carabinieri: 'Police (Carabinieri)',
};
const sosLabel = (k) => EMERGENCY_LABELS[k] || k.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

const MODES = {
  n2e: { title: 'Meaning', sub: 'Native → English', field: 'english' },
  e2n: { title: 'Say it', sub: 'English → native', field: 'native' },
  typed: { title: 'Type it', sub: 'English → native, typed', field: null },
  listen: { title: 'Listen', sub: 'Hear it, pick meaning', field: 'english' },
};

function filtered(s = settings) {
  return DATA.phrases.filter((p) =>
    (s.country === 'all' || p.country === s.country) &&
    (s.category === 'all' || p.category === s.category) &&
    (s.priority === 'all' || p.priority <= Number(s.priority)));
}

function markToday() {
  const k = L.dayKey(Date.now());
  if (!days.includes(k)) {
    days = [...days, k].slice(-400);
    store.set(KEYS.days, days);
  }
}

function go(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------- Speech ----------
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let voices = [];
function refreshVoices() { if (synth) voices = synth.getVoices(); }
if (synth) {
  refreshVoices();
  synth.addEventListener?.('voiceschanged', refreshVoices);
}
const langOf = (p) => (COUNTRY[p.country] && COUNTRY[p.country].language_code) || 'en-US';
function pickVoice(lang) {
  const norm = (x) => x.toLowerCase().replace('_', '-');
  const l = norm(lang);
  const base = l.split('-')[0];
  return voices.find((v) => norm(v.lang) === l) ||
    voices.find((v) => norm(v.lang).split('-')[0] === base) || null;
}
function speak(p, rate = 0.85) {
  if (!synth) { toast('Audio is not supported in this browser.'); return; }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(L.speakableText(p.native));
  u.lang = langOf(p);
  const v = pickVoice(u.lang);
  if (v) u.voice = v;
  else if (voices.length) toast(`No ${COUNTRY[p.country]?.language || ''} voice installed; using default.`);
  u.rate = rate;
  synth.speak(u);
}
const speakBtn = (p, extra = '') =>
  `<button type="button" class="speak-btn" data-speak="${esc(p.id)}" aria-label="Play pronunciation of ${esc(p.native)}" ${extra}>🔊</button>`;
const byId = (id) => DATA.phrases.find((p) => p.id === id);

// One delegated click handler for every 🔊 button in the app.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-speak]');
  if (!b) return;
  e.stopPropagation();
  const p = byId(b.dataset.speak);
  if (p) speak(p);
});

// ---------- Theme ----------
const themeBtn = document.getElementById('themeBtn');
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  themeBtn.textContent = t === 'light' ? '☀' : t === 'dark' ? '☾' : '◐';
  themeBtn.title = `Theme: ${t || 'auto'}`;
}
let theme = (() => { try { return localStorage.getItem(KEYS.theme) || 'auto'; } catch { return 'auto'; } })();
applyTheme(theme);
themeBtn.addEventListener('click', () => {
  theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
  try { localStorage.setItem(KEYS.theme, theme); } catch { /* ignore */ }
  applyTheme(theme);
});

// ---------- Keyboard ----------
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.showcase')) {
    if (e.key === 'Escape') closeShowcase();
    return;
  }
  if (keyHandler) keyHandler(e);
});

// ---------- Router ----------
function setActiveTab(name) {
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
}
function route() {
  keyHandler = null;
  closeShowcase();
  if (synth) synth.cancel();
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  setActiveTab(name === 'progress' ? 'progress' : name === 'trip' ? 'trip' : 'home');
  if (name === 'learn') renderLearn();
  else if (name === 'quiz') startQuiz(arg);
  else if (name === 'progress') renderProgress();
  else if (name === 'trip') renderTrip(arg);
  else renderHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- Home ----------
function swissBanner() {
  const ch = COUNTRY.ch;
  if (!ch) return '';
  return `<div class="banner">
    <strong>Switzerland uses the German set.</strong> ${esc(ch.notes)}
    <div class="row">
      <button class="btn" data-country="fr">Geneva / Lausanne → French</button>
      <button class="btn" data-country="it">Ticino → Italian</button>
    </div>
  </div>`;
}

function renderHome() {
  const list = filtered();
  const now = Date.now();
  const due = list.filter((p) => progress[p.id] && progress[p.id].box > 0 && progress[p.id].due <= now).length;
  const fresh = list.filter((p) => !progress[p.id] || !progress[p.id].box).length;
  const st = L.streak(days);
  const countryBtns = [['all', 'All'], ...DATA.meta.countries.map((c) => [c.code, c.name])]
    .map(([code, name]) => `<button type="button" data-country="${code}" aria-pressed="${settings.country === code}">${esc(name)}</button>`).join('');
  const cats = DATA.meta.categories.map((c) => `<option value="${c}" ${settings.category === c ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('');
  const country = COUNTRY[settings.country];

  $view.innerHTML = `
    <h1>Practice</h1>
    <p class="muted" style="margin-top:0">${st ? `🔥 ${st}-day streak · ` : ''}${list.length} phrases · ${due} due · ${fresh} new</p>

    <section class="card">
      <p class="section-title">Country</p>
      <div class="seg" id="countrySeg">${countryBtns}</div>
      ${country ? `<p class="small muted" style="margin:10px 0 0">${esc(country.language)}${settings.country !== 'ch' ? ` · ${esc(country.notes)}` : ''}</p>` : ''}
    </section>
    ${settings.country === 'ch' ? swissBanner() : ''}

    <section class="card">
      <p class="section-title">Filter</p>
      <div class="row">
        <label class="field">Category
          <select id="catSel"><option value="all">All categories</option>${cats}</select>
        </label>
        <label class="field">Priority
          <select id="priSel">
            <option value="all" ${settings.priority === 'all' ? 'selected' : ''}>All</option>
            <option value="1" ${settings.priority === '1' ? 'selected' : ''}>Must-know only</option>
            <option value="2" ${settings.priority === '2' ? 'selected' : ''}>Must-know + useful</option>
          </select>
        </label>
      </div>
    </section>

    <a class="btn primary block" href="#/learn" ${list.length ? '' : 'aria-disabled="true"'}>Learn with flashcards</a>

    <section class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
        <p class="section-title" style="margin:0">Quiz</p>
        <label class="small muted">Questions
          <select id="lenSel" style="width:auto;min-height:40px;margin-left:6px">
            ${[10, 20, 30].map((n) => `<option ${settings.length === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="mode-grid">
        ${Object.entries(MODES).map(([k, m]) => `<a class="btn" href="#/quiz/${k}">${m.title}<small>${m.sub}</small></a>`).join('')}
      </div>
    </section>
  `;

  $view.querySelectorAll('[data-country]').forEach((b) => b.addEventListener('click', () => {
    settings.country = b.dataset.country; saveSettings(); renderHome();
  }));
  $view.querySelector('#catSel').addEventListener('change', (e) => { settings.category = e.target.value; saveSettings(); renderHome(); });
  $view.querySelector('#priSel').addEventListener('change', (e) => { settings.priority = e.target.value; saveSettings(); renderHome(); });
  $view.querySelector('#lenSel').addEventListener('change', (e) => { settings.length = Number(e.target.value); saveSettings(); });
}

function emptyState(msg) {
  $view.innerHTML = `<div class="card center"><p>${esc(msg)}</p><a class="btn primary" href="#/">Back to filters</a></div>`;
}

// ---------- Learn ----------
function renderLearn() {
  const list = filtered();
  if (!list.length) return emptyState('No phrases match your filters.');
  if (!learn || learn.key !== JSON.stringify(settings)) {
    learn = { key: JSON.stringify(settings), list: list.slice().sort((a, b) => a.priority - b.priority), i: 0, revealed: false };
  }
  drawLearn();
  keyHandler = (e) => {
    if (e.key === 'ArrowRight') learnStep(1);
    else if (e.key === 'ArrowLeft') learnStep(-1);
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); learn.revealed = !learn.revealed; drawLearn(); }
    else if (e.key.toLowerCase() === 's') speak(learn.list[learn.i]);
  };
}
function learnStep(d) {
  learn.i = (learn.i + d + learn.list.length) % learn.list.length;
  learn.revealed = false;
  drawLearn();
}
function drawLearn() {
  const p = learn.list[learn.i];
  const c = COUNTRY[p.country];
  const box = (progress[p.id] && progress[p.id].box) || 0;
  $view.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <a href="#/" class="muted small">← Back</a>
      <span class="muted small">${learn.i + 1} / ${learn.list.length}</span>
      <button class="btn" id="shuffleBtn" style="min-height:40px;padding:6px 12px">Shuffle</button>
    </div>
    <div class="card flash" id="flash" role="button" tabindex="0" aria-label="Flip card">
      <div>
        <span class="badge">${esc(c ? c.name : p.country)}</span>
        <span class="badge">${esc(catLabel(p.category))}</span>
        ${p.priority === 1 ? '<span class="badge p1">Must-know</span>' : ''}
        ${box ? `<span class="badge">Box ${box}</span>` : ''}
      </div>
      <div class="native" lang="${esc(langOf(p))}">${esc(p.native)}</div>
      <div class="phonetic">${esc(p.phonetic)}</div>
      ${speakBtn(p)}
      ${learn.revealed
        ? `<div class="english">${esc(p.english)}</div>${p.note ? `<div class="note">💡 ${esc(p.note)}</div>` : ''}`
        : '<div class="hidden-hint">Tap to reveal English</div>'}
    </div>
    <div class="row">
      <button class="btn" id="prevBtn">← Prev</button>
      <button class="btn primary" id="nextBtn">Next →</button>
    </div>
    <p class="small muted center">Keyboard: ← → move · Space flips · S plays audio</p>
  `;
  const flash = $view.querySelector('#flash');
  const flip = () => { learn.revealed = !learn.revealed; drawLearn(); };
  flash.addEventListener('click', flip);
  $view.querySelector('#prevBtn').addEventListener('click', () => learnStep(-1));
  $view.querySelector('#nextBtn').addEventListener('click', () => learnStep(1));
  $view.querySelector('#shuffleBtn').addEventListener('click', () => {
    learn.list = L.shuffle(learn.list); learn.i = 0; learn.revealed = false; drawLearn();
  });
}

// ---------- Quiz ----------
function startQuiz(mode, customList) {
  if (!MODES[mode]) return go('#/');
  if (mode === 'listen' && !synth) {
    $view.innerHTML = '<div class="card center"><p>This browser can’t play speech, so the listening quiz isn’t available here.</p><a class="btn primary" href="#/">Back</a></div>';
    return;
  }
  const items = customList || L.pickSession(filtered(), progress, settings.length);
  if (!items.length) return emptyState('No phrases match your filters.');
  quiz = { mode, queue: items.slice(), idx: 0, graded: new Set(), requeued: new Set(), right: 0, missed: [], answered: false };
  renderQuestion();
  keyHandler = (e) => {
    if (!quiz) return;
    if (e.key === 'Enter' && quiz.answered) { e.preventDefault(); nextQuestion(); return; }
    if (!quiz.answered && /^[1-4]$/.test(e.key) && e.target.tagName !== 'INPUT') {
      const opt = $view.querySelectorAll('.option')[Number(e.key) - 1];
      if (opt) opt.click();
    }
  };
}

function grade(p, correct) {
  if (!quiz.graded.has(p.id)) {
    quiz.graded.add(p.id);
    progress[p.id] = L.review(progress[p.id], correct);
    saveProgress();
    markToday();
    if (correct) quiz.right++; else quiz.missed.push(p);
  }
  // Missed phrases come back a few questions later in the same session (practice only, not re-graded).
  if (!correct && !quiz.requeued.has(p.id)) {
    quiz.requeued.add(p.id);
    quiz.queue.splice(Math.min(quiz.idx + 4, quiz.queue.length), 0, p);
  }
  quiz.answered = true;
}

function feedbackHtml(p, ok, extra = '') {
  return `<div class="feedback ${ok ? 'ok' : 'bad'}" role="status">
    <div><strong>${ok ? 'Correct!' : 'Not quite.'}</strong> ${extra}</div>
    <div style="display:flex;gap:12px;align-items:center;margin-top:8px">
      <div style="flex:1;min-width:0">
        <div class="answer" lang="${esc(langOf(p))}">${esc(p.native)}</div>
        <div class="muted"><i>${esc(p.phonetic)}</i></div>
        <div>${esc(p.english)}</div>
      </div>
      ${speakBtn(p)}
    </div>
    ${p.note ? `<div class="note" style="margin-top:8px">💡 ${esc(p.note)}</div>` : ''}
    <button class="btn primary block" id="nextQ" style="margin-top:12px">${quiz.idx + 1 >= quiz.queue.length ? 'See results' : 'Next →'}</button>
  </div>`;
}

function showFeedback(p, ok, extra, focusNext = true) {
  const fb = $view.querySelector('#fb');
  fb.innerHTML = feedbackHtml(p, ok, extra);
  const next = fb.querySelector('#nextQ');
  next.addEventListener('click', nextQuestion);
  // Typed mode keeps focus in the input: moving focus to Next during the Enter
  // keydown would let the same keypress "click" it and skip the feedback.
  if (focusNext) next.focus({ preventScroll: true });
  fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function nextQuestion() {
  quiz.idx++;
  renderQuestion();
}

function renderQuestion() {
  if (quiz.idx >= quiz.queue.length) return renderSummary();
  quiz.answered = false;
  const p = quiz.queue[quiz.idx];
  const m = MODES[quiz.mode];
  const lang = langOf(p);
  let prompt = '';
  let body = '';

  if (quiz.mode === 'n2e') {
    prompt = `<p class="muted">What does this mean?</p><div class="big" lang="${esc(lang)}">${esc(p.native)}</div><div style="margin-top:10px">${speakBtn(p)}</div>`;
  } else if (quiz.mode === 'listen') {
    prompt = `<p class="muted">What did you hear?</p><button type="button" class="speak-btn" data-speak="${esc(p.id)}" style="width:96px;height:96px;font-size:2.4rem" aria-label="Play again">🔊</button><p class="small muted">Tap to replay</p>`;
  } else {
    prompt = `<p class="muted">How do you say this in ${esc(COUNTRY[p.country]?.language || 'the local language')}?</p><div class="big">${esc(p.english)}</div>`;
  }

  if (quiz.mode === 'typed') {
    body = `<form id="typedForm" autocomplete="off">
      <input type="text" id="typedIn" lang="${esc(lang)}" placeholder="Type it… (accents optional)" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Your answer">
      <div class="row" style="margin-top:10px">
        <button type="button" class="btn" id="dunno">Show me</button>
        <button type="submit" class="btn primary">Check</button>
      </div>
    </form>`;
  } else {
    const opts = L.shuffle([p, ...L.pickDistractors(p, DATA.phrases, m.field, 3)]);
    body = `<div class="options">${opts.map((o, i) =>
      `<button type="button" class="option" data-id="${esc(o.id)}" ${m.field === 'native' ? `lang="${esc(langOf(o))}"` : ''}><span class="muted small">${i + 1}.</span> ${esc(o[m.field])}</button>`).join('')}</div>`;
  }

  $view.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <a href="#/" class="muted small">← Quit</a>
      <span class="muted small">${esc(m.title)} · ${quiz.idx + 1} / ${quiz.queue.length}</span>
    </div>
    <div class="progressbar"><div style="width:${(quiz.idx / quiz.queue.length) * 100}%"></div></div>
    <div class="card prompt">${prompt}</div>
    ${body}
    <div id="fb"></div>
  `;

  if (quiz.mode === 'typed') {
    const input = $view.querySelector('#typedIn');
    input.focus();
    $view.querySelector('#typedForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (quiz.answered) return;
      if (!input.value.trim()) { input.focus(); return; }
      const res = L.checkTyped(input.value, p.native);
      grade(p, res.correct);
      input.readOnly = true;
      $view.querySelectorAll('#typedForm button').forEach((b) => { b.disabled = true; });
      showFeedback(p, res.correct, res.correct
        ? (res.exact ? '' : '<span class="small">(Small typo, counted as right. Check the spelling.)</span>')
        : `<span class="small">You typed “${esc(input.value)}”.</span>`, false);
    });
    $view.querySelector('#dunno').addEventListener('click', () => {
      if (quiz.answered) return;
      grade(p, false);
      input.readOnly = true;
      $view.querySelectorAll('#typedForm button').forEach((b) => { b.disabled = true; });
      showFeedback(p, false, '');
    });
  } else {
    $view.querySelectorAll('.option').forEach((btn) => btn.addEventListener('click', () => {
      if (quiz.answered) return;
      const ok = btn.dataset.id === p.id;
      grade(p, ok);
      $view.querySelectorAll('.option').forEach((b) => {
        b.disabled = true;
        if (b.dataset.id === p.id) b.classList.add('correct');
      });
      if (!ok) btn.classList.add('wrong');
      showFeedback(p, ok);
    }));
  }

  if (quiz.mode === 'listen') setTimeout(() => speak(p), 250);
}

function renderSummary() {
  const total = quiz.graded.size;
  const pct = total ? Math.round((quiz.right / total) * 100) : 0;
  const mode = quiz.mode;
  const missed = quiz.missed.slice();
  $view.innerHTML = `
    <div class="card center">
      <p class="section-title">${esc(MODES[mode].title)} · session complete</p>
      <div style="font-size:3rem;font-weight:800;line-height:1">${quiz.right} / ${total}</div>
      <p class="muted">${pct}% on first try${pct === 100 ? ' · Perfekt! Parfait! Perfetto!' : ''}</p>
    </div>
    ${missed.length ? `<section class="card"><p class="section-title">To review</p><ul class="list">
      ${missed.map((p) => `<li><div><div lang="${esc(langOf(p))}"><strong>${esc(p.native)}</strong></div><div class="small muted">${esc(p.english)}</div></div>${speakBtn(p)}</li>`).join('')}
    </ul></section>` : ''}
    <div class="row">
      ${missed.length ? '<button class="btn" id="retryMissed">Practice missed</button>' : ''}
      <button class="btn primary" id="again">New session</button>
    </div>
    <p class="center"><a href="#/" class="muted">Back to practice</a></p>
  `;
  $view.querySelector('#again').addEventListener('click', () => startQuiz(mode));
  $view.querySelector('#retryMissed')?.addEventListener('click', () => startQuiz(mode, L.shuffle(missed)));
  quiz = null;
  keyHandler = null;
}

// ---------- Progress ----------
function meter(label, list) {
  const pct = Math.round(L.mastery(list, progress) * 100);
  const c = L.boxCounts(list, progress);
  return `<div class="meter" title="${c.mastered} mastered · ${c.learning} learning · ${c.new} new">
    <span>${esc(label)}</span>
    <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(label)} mastery"><div style="width:${pct}%"></div></div>
    <span class="pct">${pct}%</span>
  </div>`;
}

function renderProgress() {
  const all = DATA.phrases;
  const counts = L.boxCounts(all, progress);
  const st = L.streak(days);
  const answers = Object.values(progress).reduce((a, c) => ({ right: a.right + (c.right || 0), seen: a.seen + (c.seen || 0) }), { right: 0, seen: 0 });
  const scoped = progressCountry === 'all' ? all : all.filter((p) => p.country === progressCountry);
  const weak = L.weakest(all, progress, 10);

  $view.innerHTML = `
    <h1>Progress</h1>
    <div class="stat-row">
      <div class="card stat"><div class="num">🔥 ${st}</div><div class="lbl">day streak</div></div>
      <div class="card stat"><div class="num">${counts.mastered}</div><div class="lbl">mastered of ${all.length}</div></div>
      <div class="card stat"><div class="num">${answers.seen ? Math.round((answers.right / answers.seen) * 100) : 0}%</div><div class="lbl">accuracy (${answers.seen})</div></div>
    </div>

    <section class="card">
      <p class="section-title">By country</p>
      ${DATA.meta.countries.map((c) => meter(c.name, all.filter((p) => p.country === c.code))).join('')}
      <p class="small muted" style="margin:8px 0 0">Mastery = average Leitner box (1–5). “Mastered” = box 4 or 5.</p>
    </section>

    <section class="card">
      <p class="section-title">By category</p>
      <div class="row" style="margin-bottom:8px">
        ${[['all', 'All'], ...DATA.meta.countries.map((c) => [c.code, c.name])].map(([k, n]) =>
          `<button class="chip" data-pc="${k}" aria-pressed="${progressCountry === k}">${esc(n)}</button>`).join('')}
      </div>
      ${DATA.meta.categories.map((cat) => {
        const list = scoped.filter((p) => p.category === cat);
        return list.length ? meter(catLabel(cat), list) : '';
      }).join('')}
    </section>

    <section class="card">
      <p class="section-title">Weakest phrases</p>
      ${weak.length ? `<ul class="list">${weak.map((p) => {
        const c = progress[p.id];
        return `<li><div style="min-width:0"><div lang="${esc(langOf(p))}"><strong>${esc(p.native)}</strong> <span class="badge">${esc(COUNTRY[p.country]?.name || p.country)}</span></div>
          <div class="small muted">${esc(p.english)} · missed ${c.wrong}× · box ${c.box}</div></div>${speakBtn(p)}</li>`;
      }).join('')}</ul>
      <button class="btn block" id="drillWeak" style="margin-top:10px">Drill these</button>` : '<p class="muted">Nothing missed yet. Take a quiz!</p>'}
    </section>

    <button class="btn block" id="resetBtn" style="color:var(--red)">Reset all progress</button>
  `;
  $view.querySelectorAll('[data-pc]').forEach((b) => b.addEventListener('click', () => { progressCountry = b.dataset.pc; renderProgress(); }));
  $view.querySelector('#drillWeak')?.addEventListener('click', () => {
    setActiveTab('home');
    startQuiz('n2e', L.shuffle(weak));
  });
  $view.querySelector('#resetBtn').addEventListener('click', () => {
    if (!confirm('Reset all quiz progress and your streak? This cannot be undone.')) return;
    progress = {}; days = [];
    saveProgress(); store.set(KEYS.days, days);
    renderProgress();
  });
}

// ---------- Trip mode ----------
function renderTrip(code) {
  const codes = DATA.meta.countries.map((c) => c.code);
  if (!codes.includes(code)) code = tripState.country || (codes.includes(settings.country) ? settings.country : codes[0]);
  tripState.country = code;
  const c = COUNTRY[code];

  // Switzerland: German by default, but Geneva/Lausanne/Montreux use French and Ticino uses Italian.
  const regions = code === 'ch'
    ? [['de', 'German · Zurich, Basel, Lucerne, Bern', 'ch'], ['fr', 'French · Geneva, Lausanne, Montreux', 'fr'], ['it', 'Italian · Ticino, Lugano', 'it']]
    : null;
  const source = regions ? (regions.find((r) => r[0] === tripState.region) || regions[0])[2] : code;
  const phrases = DATA.phrases.filter((p) => p.country === source && p.priority === 1);

  $view.innerHTML = `
    <div class="seg" style="margin-bottom:14px;grid-template-columns:repeat(${DATA.meta.countries.length},1fr)">
      ${DATA.meta.countries.map((k) => `<a class="btn ${k.code === code ? 'primary' : ''}" href="#/trip/${k.code}" aria-current="${k.code === code ? 'page' : 'false'}">${esc(k.name)}</a>`).join('')}
    </div>

    <section class="card">
      <p class="section-title">Emergency numbers · ${esc(c.name)}</p>
      <div class="sos">
        ${Object.entries(c.emergency_numbers).map(([k, n]) => `<a href="tel:${esc(n)}"><span class="n">${esc(n)}</span><span class="l">${esc(sosLabel(k))}</span></a>`).join('')}
      </div>
      <p class="small" style="margin:10px 0 0">${esc(c.notes)}</p>
    </section>

    ${regions ? `<section class="card"><p class="section-title">Where are you?</p><div class="seg" style="grid-template-columns:1fr">
      ${regions.map(([k, label]) => `<button data-region="${k}" aria-pressed="${tripState.region === k}">${esc(label)}</button>`).join('')}
    </div>${source !== 'ch' ? '<p class="small muted" style="margin:8px 0 0">Showing the ' + esc(COUNTRY[source].language) + ' set. Prices are still in CHF.</p>' : ''}</section>` : ''}

    ${DATA.meta.categories.map((cat) => {
      const list = phrases.filter((p) => p.category === cat);
      if (!list.length) return '';
      return `<section class="card"><p class="section-title">${esc(catLabel(cat))}</p>
        ${list.map((p) => `<div class="trip-phrase">
          <div class="txt" data-show="${esc(p.id)}" role="button" tabindex="0" aria-label="Show ${esc(p.native)} full screen">
            <div class="n" lang="${esc(langOf(p))}">${esc(p.native)}</div>
            <div class="p">${esc(p.phonetic)}</div>
            <div class="e">${esc(p.english)}</div>
          </div>
          ${speakBtn(p)}
        </div>`).join('')}
      </section>`;
    }).join('')}
    <p class="small muted center">Tap a phrase to show it full screen.</p>
  `;

  $view.querySelectorAll('[data-region]').forEach((b) => b.addEventListener('click', () => { tripState.region = b.dataset.region; renderTrip(code); }));
  $view.querySelectorAll('[data-show]').forEach((el) => {
    const open = () => showcase(byId(el.dataset.show));
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

function showcase(p) {
  closeShowcase();
  const el = document.createElement('div');
  el.className = 'showcase';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="n" lang="${esc(langOf(p))}">${esc(p.native)}</div>
    <div class="p">${esc(p.phonetic)}</div>
    <div class="e">${esc(p.english)}</div>
    <div class="row" style="width:100%;max-width:420px">
      ${speakBtn(p, 'style="flex:0 0 auto;width:64px;height:64px"')}
      <button class="btn primary" id="closeShow">Close</button>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('#closeShow').addEventListener('click', closeShowcase);
  el.querySelector('#closeShow').focus();
}
function closeShowcase() {
  document.querySelector('.showcase')?.remove();
}

// ---------- Boot ----------
async function boot() {
  try {
    const res = await fetch('phrases.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
    if (!DATA.meta || !Array.isArray(DATA.phrases)) throw new Error('phrases.json needs "meta" and "phrases"');
  } catch (err) {
    $view.innerHTML = `<div class="card"><h2>Couldn’t load phrases.json</h2><p class="muted">${esc(err.message)}</p>
      <p class="small">Serve this folder over http (see README). Opening index.html directly from disk blocks the data file.</p></div>`;
    return;
  }
  COUNTRY = Object.fromEntries(DATA.meta.countries.map((c) => [c.code, c]));
  if (settings.country !== 'all' && !COUNTRY[settings.country]) settings.country = 'all';
  if (settings.category !== 'all' && !DATA.meta.categories.includes(settings.category)) settings.category = 'all';
  route();
}
boot();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
