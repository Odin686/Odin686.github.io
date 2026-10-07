/* Vizancia Learn web player.
 * Runs entirely in the browser. No account, no network call, no chatbot.
 * Progress lives in localStorage for this browser profile only.
 * Shares authored content and core progression rules with iOS.
 * Checkpoint order, browser storage and UI are platform-specific.
 */
(function () {
  'use strict';
  const DB = window.VIZANCIA_CONTENT;
  const STORE_KEY = 'vizancia.learn.v1';
  const APP_VERSION = '1.0.0';

  // ---------- utilities ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const pad = (n) => String(n).padStart(2, '0');
  function dateKey(d) { d = d || new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function daysBetween(aKey, bKey) {
    const a = new Date(aKey + 'T00:00:00'), b = new Date(bKey + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // FNV-1a 64 + SplitMix64 gives stable browser checkpoints. Native shuffling
  // uses a different permutation; exact question order is not cross-platform.
  function fnv1a64(s) {
    let hash = 0xcbf29ce484222325n;
    for (const b of new TextEncoder().encode(s)) {
      hash ^= BigInt(b);
      hash = (hash * 0x100000001b3n) & 0xFFFFFFFFFFFFFFFFn;
    }
    return hash;
  }
  function splitmix(seed) {
    let state = seed === 0n ? 0x9e3779b97f4a7c15n : seed;
    const M = 0xFFFFFFFFFFFFFFFFn;
    return function () {
      state = (state + 0x9e3779b97f4a7c15n) & M;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;
      z = z ^ (z >> 31n);
      return Number(z >> 11n) / 9007199254740992;
    };
  }
  function toast(msg) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 2200);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch (e) { window.prompt('Copy this text:', text); }
  }

  // ---------- content lookups ----------
  const CATS = DB.categories.slice().sort((a, b) => a.order - b.order);
  const CAT_BY_ID = Object.fromEntries(CATS.map((c) => [c.id, c]));
  const LESSON_INDEX = {};
  const QUESTION_INDEX = {};
  for (const c of CATS) for (const l of c.lessons) {
    LESSON_INDEX[l.id] = { lesson: l, category: c };
    for (const q of l.questions) QUESTION_INDEX[q.id] = { question: q, lesson: l, category: c };
  }
  const TIER_OF = (c) => (DB.tier1Ids.includes(c.id) ? 1 : c.unlock.kind === 'completeTier1' ? 2 : c.unlock.kind === 'completeTier2Minimum' ? 3 : 1);
  const TIER_NAMES = { 1: 'The Foundations', 2: 'Going Deeper', 3: 'The Challenge' };
  const ICONS = { brain: '🧠', 'clock.arrow.circlepath': '🕰️', 'gearshape.2.fill': '⚙️', 'shield.fill': '🛡️', 'graduationcap.fill': '🎓', 'paintbrush.fill': '🎨', 'bubble.left.and.bubble.right.fill': '💬', 'scale.3d': '⚖️', 'briefcase.fill': '💼', 'heart.text.square.fill': '🩺', 'music.note': '🎵', 'book.closed.fill': '📖', 'sparkles': '✨', 'wrench.and.screwdriver.fill': '🔧', 'checkmark.seal.fill': '✅', 'hammer.fill': '🔨', 'checkmark.gearshape.fill': '🧪', 'cpu': '💻', 'lightbulb.fill': '💡', 'globe': '🌍', 'eye.fill': '👁️' };
  const catEmoji = (c) => ICONS[c.icon] || '📘';
  const BANDS = [
    { id: 'earlyElementary', label: 'Grades K-2 guided', ceiling: 0 },
    { id: 'elementary', label: 'Grades 3-5', ceiling: 0 },
    { id: 'middle', label: 'Grades 6-8', ceiling: 1 },
    { id: 'high', label: 'Grades 9-12', ceiling: 2 },
    { id: 'adult', label: 'Adult learner', ceiling: 2 },
  ];
  const DIFF_ORDER = { beginner: 0, intermediate: 1, advanced: 2 };
  const LEVELS = [[1, 'AI Curious', 0], [2, 'Data Explorer', 100], [3, 'Algorithm Apprentice', 300], [4, 'Neural Networker', 600], [5, 'Model Builder', 1000], [6, 'Prompt Whisperer', 1500], [7, 'AI Strategist', 2200], [8, 'Ethics Guardian', 3000], [9, 'Machine Master', 4000], [10, 'AI Visionary', 5500], [11, 'Digital Sage', 7500], [12, 'Singularity Scholar', 10000]];
  const XP = { firstTry: 15, retry: 5, lessonBonus: 25, perfectBonus: 50 };
  const LEITNER_DAYS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };
  const QTYPE_LABEL = { multipleChoice: 'Multiple choice', trueFalse: 'True or false', fillInBlank: 'Fill in the blank', matchPairs: 'Match the pairs', sortOrder: 'Put in order', scenarioJudgment: 'Scenario', explain: 'Explain it' };
  const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

  // ---------- state ----------
  const defaultState = () => ({
    v: 1, name: '', band: 'middle', teacherUnlock: false, xp: 0,
    streak: 0, lastActive: null, activeDays: [],
    completed: {}, checkpoints: {}, categoryStats: {}, skill: {}, leitner: {}, missed: [],
    tickets: [], createdAt: dateKey(),
  });
  let S = load();
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) return Object.assign(defaultState(), JSON.parse(raw)); } catch (e) { /* private mode */ }
    return defaultState();
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  function resetProgress() { S = defaultState(); save(); }

  const band = () => BANDS.find((b) => b.id === S.band) || BANDS[2];
  const ceiling = () => (S.teacherUnlock ? 2 : band().ceiling);
  function filterQuestions(qs) {
    const c = ceiling();
    const ok = qs.filter((q) => (DIFF_ORDER[q.difficulty] || 0) <= c);
    return ok;
  }
  const stemFor = (q) => (['earlyElementary', 'elementary'].includes(S.band) && q.simple ? q.simple : q.text);
  const isDone = (lessonId) => !!S.completed[lessonId];
  const completedIn = (catId) => CAT_BY_ID[catId].lessons.filter((l) => isDone(l.id)).length;
  const isCatComplete = (cat) => cat.lessons.every((l) => isDone(l.id));
  function isLocked(cat) {
    if (S.teacherUnlock) return false;
    const u = cat.unlock;
    switch (u.kind) {
      case 'none': return false;
      case 'completeCategory': return !isCatComplete(CAT_BY_ID[u.value]);
      case 'completeCategoryMinimum': return completedIn(u.value) < 2;
      case 'completeTier1': return !DB.tier1Ids.every((id) => isCatComplete(CAT_BY_ID[id]));
      case 'completeTier2Minimum': return CATS.filter((c) => TIER_OF(c) === 2 && isCatComplete(c)).length < (u.value || 0);
      default: return false;
    }
  }
  function isLessonLocked(cat, lesson) {
    if (S.teacherUnlock) return false;
    const index = cat.lessons.findIndex((l) => l.id === lesson.id);
    return isLocked(cat) || cat.lessons.slice(0, index).some((l) => !isDone(l.id));
  }
  function nextLesson() {
    for (const c of CATS) {
      if (isLocked(c)) continue;
      const l = c.lessons.find((x) => !isDone(x.id));
      if (l) return { lesson: l, category: c };
    }
    return null;
  }
  function levelFor(xp) { let cur = LEVELS[0]; for (const L of LEVELS) if (xp >= L[2]) cur = L; return cur; }
  function recordActivity(xpEarned) {
    const today = dateKey();
    if (!S.activeDays.includes(today)) S.activeDays.push(today);
    if (S.lastActive !== today) {
      S.streak = S.lastActive && daysBetween(S.lastActive, today) === 1 ? S.streak + 1 : 1;
      S.lastActive = today;
    }
    S.xp += xpEarned;
  }
  function starsEarned(correct, total) {
    if (total <= 0) return 1;
    if (correct === total) return 3;
    const allowed = Math.max(1, Math.floor(total / 5));
    return total - correct <= allowed ? 2 : 1;
  }
  // Leitner
  function leitnerAdd(qid) { if (!S.leitner[qid]) S.leitner[qid] = { box: 1, last: null, correct: 0, incorrect: 0 }; }
  function leitnerRecord(qid, ok) {
    const c = S.leitner[qid] || { box: ok ? 2 : 1, last: null, correct: 0, incorrect: 0 };
    if (S.leitner[qid]) { c.box = ok ? Math.min(5, c.box + 1) : 1; }
    if (ok) c.correct++; else c.incorrect++;
    c.last = dateKey();
    S.leitner[qid] = c;
  }
  function dueCards() {
    const today = dateKey();
    return Object.entries(S.leitner)
      .filter(([qid, c]) => QUESTION_INDEX[qid] && (!c.last || daysBetween(c.last, today) >= (LEITNER_DAYS[c.box] || 1)))
      .sort((a, b) => a[1].box - b[1].box)
      .map(([qid]) => QUESTION_INDEX[qid]);
  }
  // Checkpoints
  function checkpointLesson(cat, final) {
    const covered = final ? cat.lessons : cat.lessons.slice(0, 3);
    if (covered.length < 2) return null;
    const id = `${cat.id}_${final ? 'boss' : 'checkpoint'}`;
    const rng = splitmix(fnv1a64(id));
    let picked = [];
    // Explain items are self-rated, never scored, so checkpoints skip them (matches LessonContentProvider.checkpointPool).
    for (const l of covered) picked = picked.concat(shuffle(filterQuestions(l.questions.filter((q) => q.type !== 'explain')), rng).slice(0, 2));
    picked = shuffle(picked, rng).slice(0, final ? 10 : 8);
    return { id, title: final ? 'Boss Challenge' : 'Checkpoint', description: final ? 'Everything in this module, mixed together. Check your understanding.' : 'A quick mix of the lessons so far. Show what stuck!', questions: picked, cards: [], checkpoint: true, categoryId: cat.id };
  }
  function checkpointAvailable(cat, final) {
    const need = final ? cat.lessons : cat.lessons.slice(0, 3);
    return need.every((l) => isDone(l.id));
  }

  // ---------- routing ----------
  const params = new URLSearchParams(location.search);
  const CLASS = params.get('class') ? { cat: params.get('class'), minutes: Number(params.get('minutes') || 20), lesson: params.get('lesson') || '', band: params.get('band') || '' } : null;
  if (CLASS && CLASS.band && BANDS.some((b) => b.id === CLASS.band)) { S.band = CLASS.band; save(); }
  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [name, ...rest] = hash.split('/');
    return { name: name || (CLASS ? 'class' : params.get('teacher') ? 'teacher' : 'path'), arg: rest.join('/') };
  }
  window.addEventListener('hashchange', render);

  // ---------- top bar ----------
  function renderTopbar(current) {
    const lvl = levelFor(S.xp);
    const nav = [['path', '🗺️', 'Learn'], ['review', '🔁', 'Review'], ['report', '📊', 'Report'], ['teacher', '🍎', 'Teacher']];
    $('#topbar').replaceChildren(h('div', { class: 'topbar-inner' },
      h('a', { class: 'brand', href: '#/path' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, 'V'), 'Vizancia'),
      h('nav', { class: 'nav', 'aria-label': 'Sections' }, nav.map(([id, ic, label]) => h('a', { href: `#/${id}`, 'aria-current': current === id ? 'page' : null, title: label }, ic, ' ', h('span', null, label)))),
      h('div', { class: 'stats' },
        h('span', { class: 'pill xp', title: lvl[1] }, '⭐ ', `${S.xp} XP`),
        h('span', { class: 'pill streak' }, '🔥 ', `${S.streak}`),
        h('button', { class: 'pill band', onclick: openSettings, 'aria-label': 'Settings' }, S.name ? `${S.name} · ` : '', band().label, ' ⚙️'),
      ),
    ));
  }

  // ---------- views ----------
  function render() {
    const r = route();
    const main = $('#main');
    renderTopbar(r.name);
    main.replaceChildren();
    window.scrollTo(0, 0);
    switch (r.name) {
      case 'lesson': return viewLesson(main, r.arg);
      case 'checkpoint': return viewCheckpoint(main, r.arg, false);
      case 'boss': return viewCheckpoint(main, r.arg, true);
      case 'review': return viewReview(main);
      case 'report': return viewReport(main);
      case 'teacher': return viewTeacher(main);
      case 'class': return viewClass(main);
      case 'about': return viewAbout(main);
      case 'practice': return viewPractice(main, r.arg);
      default: return viewPath(main);
    }
  }

  function viewPractice(main, id) {
    const available = (DB.guidedPractices || []).filter((p) => p.stage === S.band && p.questions.every((q) => DIFF_ORDER[q.difficulty] <= ceiling()));
    const root = h('div', { class: 'wrap narrow' }); main.append(root);
    const practice = available.find((p) => p.id === id);
    if (!practice) {
      root.append(h('h1', null, 'Learn, check, build'), h('p', null, 'Short activities for your stage. No placement test, timer or written answer is required.'));
      for (const p of available) root.append(h('div', { class: 'card', style: 'margin-bottom:16px' }, h('h2', null, p.title), h('p', null, p.introduction), h('a', { class: 'btn primary', href: `#/practice/${p.id}` }, `Start ${p.questions.length} questions`)));
      root.append(h('p', { class: 'muted' }, 'Answers are not saved and do not unlock chapters or certify a skill.'), h('a', { class: 'btn ghost', href: '#/path' }, 'Back to path')); return;
    }
    let index = 0, firstCorrect = 0;
    function paint() {
      root.replaceChildren();
      if (index >= practice.questions.length) {
        root.append(h('div', { class: 'card' }, h('h1', null, 'What will you try next?'), h('p', null, `${firstCorrect}/${practice.questions.length} first choices supported by the evidence`), h('p', null, 'Explain a decision to someone or try a new example independently. This is practice evidence, not a mastery rating.'), h('a', { class: 'btn primary', href: '#/practice' }, 'Back to activities'))); return;
      }
      const q = practice.questions[index];
      root.append(h('h1', null, practice.title), h('p', null, `Question ${index + 1}/${practice.questions.length}`), h('div', { class: 'card', 'data-test': 'practice-evidence' }, practice.evidence[index]), h('h2', null, stemFor(q)));
      const options = h('div', { class: 'actions', style: 'flex-direction:column;align-items:stretch' });
      const feedback = h('div'); root.append(options, feedback, h('a', { class: 'btn ghost', href: '#/practice' }, 'Close activity'));
      for (const option of shuffle(q.options)) options.append(h('button', { class: 'btn ghost', 'data-practice-opt': option, onclick: () => {
        for (const b of options.querySelectorAll('button')) b.disabled = true;
        const correct = option === q.correct; if (correct) firstCorrect++;
        feedback.append(h('div', { class: 'card', role: 'status' }, h('h3', null, correct ? 'Supported by the evidence' : "Let's check that choice"), h('p', null, q.explanation), h('h3', null, 'Talk it through'), h('p', null, q.transfer)), h('button', { class: 'btn primary', 'data-test': 'practice-next', onclick: () => { index++; paint(); window.scrollTo(0, 0); } }, index + 1 === practice.questions.length ? 'Reflect on this practice' : 'Next question'));
      } }, option));
    }
    paint();
  }

  function viewPath(main) {
    const wrap = h('div', { class: 'wrap' });
    const nl = nextLesson();
    if (nl) {
      wrap.append(h('a', { class: 'hero', href: `#/lesson/${nl.lesson.id}` },
        h('div', { class: 'play', 'aria-hidden': 'true' }, '▶'),
        h('div', null, h('div', { class: 'eyebrow' }, isDone(nl.lesson.id) ? 'Replay' : 'Continue'), h('h2', null, nl.lesson.title), h('div', { class: 'sub' }, nl.category.name)),
        h('div', { class: 'arrow', 'aria-hidden': 'true' }, '→')));
    } else {
      wrap.append(h('div', { class: 'card' }, h('h2', null, 'Every unlocked lesson is complete'), h('p', null, 'Try a Boss Challenge, review what you missed, or ask a teacher to unlock the next tier.')));
    }
    const due = dueCards().length;
    if (due) wrap.append(h('div', { class: 'card', style: 'margin-top:14px' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', null, `${due} question${due === 1 ? '' : 's'} want a rematch`), h('div', { class: 'small muted' }, 'Spaced review keeps missed ideas from fading.')), h('a', { class: 'btn solid', href: '#/review' }, 'Review'))));

    wrap.append(h('div', { class: 'card', style: 'margin:16px 0' }, h('h2', null, 'Learn, check, build'), h('p', null, 'Start with safety, check an AI answer, or practise a builder workflow for your stage.'), h('a', { class: 'btn solid', href: '#/practice' }, 'Quick practice')));
    let lastTier = 0;
    for (const cat of CATS) {
      const tier = TIER_OF(cat);
      if (tier !== lastTier) { wrap.append(h('div', { class: 'tier' }, h('span', null, TIER_NAMES[tier]))); lastTier = tier; }
      const locked = isLocked(cat);
      const section = h('section', { class: `cat${locked ? ' locked' : ''}`, 'aria-label': cat.name });
      section.append(h('div', { class: 'cat-head' },
        h('div', { class: 'cat-icon', 'aria-hidden': 'true' }, catEmoji(cat)),
        h('div', null, h('div', { class: 'cat-title' }, cat.name), h('div', { class: 'cat-sub' }, locked ? unlockHint(cat) : `${completedIn(cat.id)}/${cat.lessons.length} complete · ${cat.description}`), h('div', { class: 'tags' }, cat.bigIdeas.map((b) => h('span', { class: 'tag' }, DB.bigIdeas[b] || b))))));
      const nodes = h('div', { class: 'nodes' });
      cat.lessons.forEach((l, i) => {
        const done = isDone(l.id);
        const stars = done ? S.completed[l.id].stars : 0;
        const lessonLocked = isLessonLocked(cat, l);
        const node = h('a', { class: `node${done ? ' done' : ''}${lessonLocked ? ' locked' : ''}`, href: lessonLocked ? null : `#/lesson/${l.id}`, 'aria-disabled': lessonLocked ? 'true' : null, tabindex: lessonLocked ? -1 : null },
          h('span', { class: 'dot', 'aria-hidden': 'true' }, lessonLocked ? '🔒' : done ? '✓' : String(i + 1)),
          h('span', null, h('div', { class: 'label' }, l.title), done ? h('div', { class: 'stars', 'aria-label': `${stars} stars` }, '★'.repeat(stars) + '☆'.repeat(3 - stars)) : h('div', { class: 'meta' }, `${filterQuestions(l.questions).length} questions`)));
        nodes.append(node);
        if (i === 2 && cat.lessons.length > 3) nodes.append(checkNode(cat, false, locked));
      });
      nodes.append(checkNode(cat, true, locked));
      section.append(nodes);
      wrap.append(section);
    }
    wrap.append(h('p', { class: 'small muted', style: 'margin-top:30px;text-align:center' }, 'Progress is saved in this browser only. Nothing is sent anywhere. ', h('a', { href: '#/about' }, 'About Vizancia Learn')));
    main.append(wrap);
  }
  function checkNode(cat, final, catLocked) {
    const avail = !catLocked && checkpointAvailable(cat, final);
    const id = `${cat.id}_${final ? 'boss' : 'checkpoint'}`;
    const done = S.checkpoints[id];
    return h('a', { class: `node ${final ? 'boss' : 'check'}${!avail ? ' locked' : ''}${done ? ' done' : ''}`, href: avail ? `#/${final ? 'boss' : 'checkpoint'}/${cat.id}` : null, 'aria-disabled': avail ? null : 'true', tabindex: avail ? null : -1 },
      h('span', { class: 'dot', 'aria-hidden': 'true' }, final ? '👑' : '🏁'),
      h('span', null, h('div', { class: 'label' }, final ? 'Boss Challenge' : 'Checkpoint'), h('div', { class: 'meta' }, done ? `Best ${done.correct}/${done.total}` : avail ? 'Ready' : final ? 'Finish every lesson' : 'Finish the first 3')));
  }
  function unlockHint(cat) {
    const u = cat.unlock;
    if (u.kind === 'completeTier1') return 'Finish all four Foundations modules to unlock';
    if (u.kind === 'completeTier2Minimum') return `Finish ${u.value} Going Deeper modules to unlock`;
    if (u.kind === 'completeCategory') return `Finish ${CAT_BY_ID[u.value].name} to unlock`;
    if (u.kind === 'completeCategoryMinimum') return `Finish 2 lessons in ${CAT_BY_ID[u.value].name} to unlock`;
    return 'Locked';
  }

  // ---------- lesson engine ----------
  function viewLesson(main, lessonId, opts) {
    const entry = LESSON_INDEX[lessonId];
    if (!entry) { main.append(h('div', { class: 'card' }, 'Lesson not found. ', h('a', { href: '#/path' }, 'Back to the path'))); return; }
    if (isLessonLocked(entry.category, entry.lesson) && !(opts && opts.force)) { location.hash = '#/path'; return; }
    runSession(main, { id: entry.lesson.id, title: entry.lesson.title, description: entry.lesson.description, questions: filterQuestions(entry.lesson.questions), cards: entry.lesson.cards, categoryId: entry.category.id, checkpoint: false }, opts || {});
  }
  function viewCheckpoint(main, catId, final) {
    const cat = CAT_BY_ID[catId];
    if (!cat || !checkpointAvailable(cat, final)) { location.hash = '#/path'; return; }
    const lesson = checkpointLesson(cat, final);
    runSession(main, lesson, {});
  }

  function runSession(main, lesson, opts) {
    const cat = CAT_BY_ID[lesson.categoryId];
    const total = lesson.questions.length;
    const scoredTotal = lesson.questions.filter(q => q.type !== "explain").length;
    const sess = { phase: lesson.cards.length ? 'cards' : 'question', cardIndex: 0, index: 0, firstCorrect: 0, xp: 0, missed: [], repairQueue: [], repairCorrect: 0, answered: false, results: [] };
    const root = h('div', { class: 'wrap' });
    main.append(root);

    function header(label) {
      const done = sess.phase === 'cards' ? 0 : sess.phase === 'repair' ? total : Math.min(sess.index, total);
      return h('div', { class: 'lesson-top' },
        h('button', { class: 'close', 'aria-label': 'Exit lesson', onclick: () => { if (opts.onExit) opts.onExit(); else location.hash = '#/path'; } }, '✕'),
        h('div', { class: 'grow' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', null, lesson.title), h('span', { class: 'small muted' }, label)), h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done }, h('i', { style: `width:${total ? (done / total) * 100 : 0}%` }))));
    }
    function paint() {
      root.replaceChildren();
      if (sess.phase === 'cards') return paintCard();
      if (sess.phase === 'done') return paintDone();
      const q = sess.phase === 'repair' ? sess.repairQueue[sess.index] : lesson.questions[sess.index];
      paintQuestion(q, sess.phase === 'repair');
    }
    function paintCard() {
      const card = lesson.cards[sess.cardIndex];
      root.append(header(`Idea ${sess.cardIndex + 1} of ${lesson.cards.length}`));
      root.append(h('div', { class: 'card tcard' }, h('div', { class: 'emoji', 'aria-hidden': 'true' }, card.emoji), h('h2', null, card.title), h('p', null, card.body), card.funFact ? h('div', { class: 'fact' }, '💡 ', card.funFact) : null,
        h('div', { class: 'dots', 'aria-hidden': 'true' }, lesson.cards.map((_, i) => h('i', { class: i === sess.cardIndex ? 'on' : '' })))));
      root.append(h('div', { class: 'actions' },
        sess.cardIndex > 0 ? h('button', { class: 'btn ghost', onclick: () => { sess.cardIndex--; paint(); } }, 'Back') : null,
        h('button', { class: 'btn primary', 'data-test': 'next', onclick: () => { if (sess.cardIndex + 1 < lesson.cards.length) { sess.cardIndex++; } else { sess.phase = 'question'; } paint(); } }, sess.cardIndex + 1 < lesson.cards.length ? 'Next' : `Start ${total} questions`)));
    }
    function paintQuestion(q, isRepair) {
      const label = isRepair ? `Repair ${sess.index + 1} of ${sess.repairQueue.length}` : `Question ${sess.index + 1} of ${total}`;
      root.append(header(label));
      const card = h('div', { class: 'card', 'data-qid': q.id });
      card.append(h('div', { class: 'qtype' }, (isRepair ? 'Try again · ' : '') + (QTYPE_LABEL[q.type] || 'Question')));
      const widget = buildWidget(q, card);
      const fb = h('div', { id: 'fb' });
      const actions = h('div', { class: 'actions' });
      const checkBtn = h('button', { class: 'btn primary', 'data-test': 'check', disabled: true, onclick: onCheck }, 'Check');
      actions.append(checkBtn);
      card.append(fb, actions);
      root.append(card);
      widget.onReady = (ready) => { checkBtn.disabled = !ready; };
      // Sorting has an answer immediately. Preserve readiness reported while
      // building a widget, before the Check button's listener is installed.
      checkBtn.disabled = !widget.isReady;
      function onCheck() {
        const ok = widget.evaluate();
        widget.lock(ok);
        sess.answered = true;
        if (!isRepair && q.type !== "explain") {
          if (ok) { sess.firstCorrect++; sess.xp += XP.firstTry; } else { sess.missed.push(q); leitnerAdd(q.id); }
          sess.results.push({ id: q.id, ok });
        } else if (isRepair && ok && q.type !== "explain") { sess.repairCorrect++; sess.xp += XP.retry; }
        if (q.type !== "explain" && (lesson.checkpoint || isRepair)) leitnerRecord(q.id, ok);
        const stats = S.categoryStats[lesson.categoryId] || (S.categoryStats[lesson.categoryId] = { correct: 0, total: 0 });
        if (q.type !== "explain" && !isRepair) { stats.total++; if (ok) stats.correct++; }
        save();
        const title = q.type === 'explain' ? 'Compare your explanation below.' : ok ? 'Correct' : `Not quite. The answer: ${answerText(q)}`;
        fb.replaceChildren(h('div', { class: `feedback${ok ? '' : ' bad'}`, role: 'alert' }, h('b', null, title), h('div', { class: 'why' }, q.explanation), q.transfer ? h('div', { class: 'why', style: 'margin-top:6px' }, h('b', { style: 'display:inline;font-size:13px' }, 'Try this: '), q.transfer) : null));
        actions.replaceChildren(h('button', { class: 'btn primary', 'data-test': 'continue', onclick: advance }, 'Continue'));
        actions.firstChild.focus();
      }
      function advance() {
        sess.index++;
        const queue = isRepair ? sess.repairQueue : lesson.questions;
        if (sess.index >= queue.length) {
          if (!isRepair && sess.missed.length) { sess.phase = 'repair'; sess.repairQueue = sess.missed.slice(); sess.index = 0; }
          else finish();
        }
        paint();
      }
    }
    function finish() {
      sess.phase = 'done';
      const earned = starsEarned(sess.firstCorrect, scoredTotal);
      const repairedAll = sess.missed.length > 0 && sess.repairCorrect === sess.missed.length;
      const stars = repairedAll ? Math.max(2, earned) : earned;
      let xp = sess.xp + XP.lessonBonus + (sess.firstCorrect + sess.repairCorrect === scoredTotal ? XP.perfectBonus : 0);
      if (lesson.checkpoint) {
        const prev = S.checkpoints[lesson.id];
        S.checkpoints[lesson.id] = { correct: Math.max(sess.firstCorrect, prev ? prev.correct : 0), total: scoredTotal, date: dateKey() };
        // Native practice pays the same completion bonus on replay.
      } else {
        const prev = S.completed[lesson.id];
        S.completed[lesson.id] = { stars: Math.max(stars, prev ? prev.stars : 0), correct: sess.firstCorrect, total: scoredTotal, date: dateKey() };
        for (const b of cat.bigIdeas) S.skill[b] = (S.skill[b] || 0) + (sess.firstCorrect + sess.repairCorrect) * 4 + (sess.firstCorrect + sess.repairCorrect === scoredTotal ? 10 : 0);
      }
      recordActivity(xp);
      sess.finalXP = xp; sess.stars = stars;
      save();
      if (opts.onFinish) opts.onFinish({ correct: sess.firstCorrect, total: scoredTotal, stars, xp, results: sess.results });
    }
    function paintDone() {
      const stars = sess.stars;
      const next = nextLesson();
      root.append(h('div', { class: 'card done', 'data-test': 'done' },
        h('div', { class: 'big', 'aria-hidden': 'true' }, stars === 3 ? '🏆' : stars === 2 ? '🎉' : '💪'),
        h('h1', null, stars === 3 ? 'Flawless!' : stars === 2 ? 'Well done' : 'Lesson complete'),
        h('div', { class: 'starrow', 'aria-label': `${stars} of 3 stars` }, h('span', null, '★'.repeat(stars)), h('span', { class: 'off' }, '★'.repeat(3 - stars))),
        h('div', { class: 'kpis' }, h('div', { class: 'kpi' }, h('b', null, `${sess.firstCorrect}/${scoredTotal}`), h('span', null, 'First try')), h('div', { class: 'kpi' }, h('b', null, `+${sess.finalXP}`), h('span', null, 'XP')), sess.missed.length ? h('div', { class: 'kpi' }, h('b', null, `${sess.repairCorrect}/${sess.missed.length}`), h('span', null, 'Repaired')) : null),
        sess.missed.length ? h('p', { class: 'small muted' }, `${sess.missed.length} missed idea${sess.missed.length === 1 ? '' : 's'} joined your review deck.`) : h('p', { class: 'small muted' }, 'Nothing to review from this lesson.'),
        h('div', { class: 'actions', style: 'justify-content:center' },
          opts.onDone ? h('button', { class: 'btn primary', 'data-test': 'finish', onclick: opts.onDone }, opts.doneLabel || 'Continue') : null,
          !opts.onDone && next ? h('a', { class: 'btn primary', href: `#/lesson/${next.lesson.id}` }, 'Next lesson') : null,
          !opts.onDone ? h('a', { class: 'btn ghost', href: '#/path' }, 'Back to path') : null)));
    }
    paint();
    return sess;
  }

  function answerText(q) {
    if (q.type === 'sortOrder') return q.correctAnswers.join(' → ');
    if (q.type === 'matchPairs') return q.pairs.map((p) => `${p.term}: ${p.definition}`).join('; ');
    return q.correct;
  }

  // ---------- question widgets ----------
  function buildWidget(q, card) {
    const w = { onReady: null, isReady: false, evaluate: () => false, lock: () => {} };
    const ready = (v) => { w.isReady = v; if (w.onReady) w.onReady(v); };
    if (q.type === 'matchPairs') return widgetPairs(q, card, w, ready);
    if (q.type === 'sortOrder') return widgetSort(q, card, w, ready);
    if (q.type === 'explain') return widgetExplain(q, card, w, ready);
    // choice types
    const stem = h('p', { class: 'stem' });
    if (q.type === 'fillInBlank') {
      const parts = stemFor(q).split(/_{3,}/);
      stem.append(parts[0], h('span', { class: 'blank', id: 'blank' }, ' '), parts.slice(1).join('___'));
    } else stem.textContent = stemFor(q);
    card.append(stem);
    const options = q.type === 'trueFalse' ? q.options : shuffle(q.options);
    let selected = null;
    const list = h('div', { class: 'opts', role: 'radiogroup', 'aria-label': 'Answer choices' });
    const buttons = options.map((opt, i) => h('button', { class: 'opt', role: 'radio', 'aria-checked': 'false', 'data-opt': opt, onclick: () => {
      selected = opt;
      buttons.forEach((b) => { b.classList.toggle('sel', b.dataset.opt === opt); b.setAttribute('aria-checked', b.dataset.opt === opt ? 'true' : 'false'); });
      const blank = $('#blank', card); if (blank) blank.textContent = opt;
      ready(true);
    } }, h('span', { class: 'key', 'aria-hidden': 'true' }, String.fromCharCode(65 + i)), h('span', null, opt)));
    list.append(...buttons);
    card.append(list);
    w.evaluate = () => selected === q.correct;
    w.lock = () => { buttons.forEach((b) => { b.disabled = true; if (b.dataset.opt === q.correct) b.classList.add('ok'); else if (b.dataset.opt === selected) b.classList.add('bad'); }); };
    return w;
  }
  function widgetPairs(q, card, w, ready) {
    card.append(h('p', { class: 'stem' }, stemFor(q)), h('p', { class: 'small muted' }, 'Tap a term, then tap its match.'));
    const terms = q.pairs.map((p) => p.term);
    const defs = shuffle(q.pairs.map((p) => p.definition));
    const pairing = {}; // term -> definition
    let activeTerm = null;
    const left = h('div', { class: 'col' }), right = h('div', { class: 'col' });
    const paint = () => {
      left.replaceChildren(...terms.map((t) => h('button', { class: `opt${activeTerm === t ? ' sel' : ''}${pairing[t] ? ' paired' : ''}`, 'data-term': t, 'aria-pressed': activeTerm === t ? 'true' : 'false', onclick: () => { activeTerm = activeTerm === t ? null : t; paint(); } }, t, pairing[t] ? h('span', { class: 'badge', 'aria-label': 'paired' }, Object.keys(pairing).indexOf(t) + 1) : null)));
      right.replaceChildren(...defs.map((d) => { const owner = Object.keys(pairing).find((t) => pairing[t] === d); return h('button', { class: `opt${owner ? ' paired' : ''}`, 'data-def': d, onclick: () => { if (!activeTerm) return; for (const t of Object.keys(pairing)) if (pairing[t] === d) delete pairing[t]; pairing[activeTerm] = d; activeTerm = null; paint(); ready(Object.keys(pairing).length === terms.length); } }, d, owner ? h('span', { class: 'badge' }, Object.keys(pairing).indexOf(owner) + 1) : null); }));
    };
    paint();
    card.append(h('div', { class: 'pairs' }, left, right));
    w.evaluate = () => q.pairs.every((p) => pairing[p.term] === p.definition);
    w.lock = () => { card.querySelectorAll('.pairs button').forEach((b) => { b.disabled = true; }); card.querySelectorAll('[data-term]').forEach((b) => { const t = b.dataset.term; const right = q.pairs.find((p) => p.term === t).definition; b.classList.add(pairing[t] === right ? 'ok' : 'bad'); }); };
    return w;
  }
  // Explain it: a written answer compared with a model answer and rubric.
  // Writing is not automatically graded. An explicit self-rating controls review.
  function widgetExplain(q, card, w, ready) {
    card.append(h('p', { class: 'stem' }, stemFor(q)), h('p', { class: 'small muted' }, 'Write one or two sentences in your own words. Your explanation is not automatically graded.'));
    const ta = h('textarea', { 'aria-label': 'Your answer', rows: 4, 'data-explain': '1', style: 'font-family:inherit;font-size:16px;min-height:110px' });
    const counter = h('div', { class: 'small muted', 'aria-live': 'polite' }, '0 words');
    ta.addEventListener('input', () => { const n = wordCount(ta.value); counter.textContent = `${n} word${n === 1 ? '' : 's'}`; ready(ta.value.trim().length > 0); });
    card.append(ta, counter);
    w.evaluate = () => ta.value.trim().length > 0;
    w.lock = () => {
      ta.disabled = true;
      const box = h('div', { class: 'stack', style: 'margin-top:12px' },
        h('div', null, h('div', { class: 'eyebrow' }, 'A strong answer'), h('p', { style: 'margin:4px 0 0;font-weight:700' }, q.correct)),
        q.options.length ? h('div', null, h('div', { class: 'eyebrow' }, 'Does your answer mention'), h('ul', { style: 'margin:4px 0 0' }, q.options.map((o) => h('li', null, o)))) : null,
        h('div', null, h('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'How close were you?'), h('div', { class: 'seg', role: 'group', 'aria-label': 'Self check' },
          ['Got it', 'Partly', 'Not yet'].map((label) => h('button', { 'aria-pressed': 'false', 'data-rate': label, onclick: (e) => {
            box.querySelectorAll('[data-rate]').forEach((b) => { b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'); b.disabled = true; });
            if (label !== 'Got it') { leitnerRecord(q.id, false); save(); toast('Added to your review deck'); } else if (S.leitner[q.id]) { leitnerRecord(q.id, true); save(); }
          } }, label)))));
      card.append(box);
    };
    return w;
  }
  function widgetSort(q, card, w, ready) {
    card.append(h('p', { class: 'stem' }, stemFor(q)), h('p', { class: 'small muted' }, 'Use the arrows to put the steps in order, first to last.'));
    let order = shuffle(q.options);
    if (order.join('|') === q.correctAnswers.join('|')) order = order.slice().reverse();
    const list = h('div', { class: 'sortlist', role: 'list' });
    const paint = () => {
      list.replaceChildren(...order.map((item, i) => h('div', { class: 'opt', role: 'listitem', 'data-item': item }, h('span', { class: 'n', 'aria-hidden': 'true' }, i + 1), h('span', null, item),
        h('span', { class: 'ctrl' }, h('button', { 'aria-label': `Move "${item}" up`, disabled: i === 0, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; paint(); } }, '↑'), h('button', { 'aria-label': `Move "${item}" down`, disabled: i === order.length - 1, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; paint(); } }, '↓')))));
    };
    paint();
    card.append(list);
    ready(true);
    w.evaluate = () => order.join('|') === q.correctAnswers.join('|');
    w.lock = () => { list.querySelectorAll('button').forEach((b) => { b.disabled = true; }); list.querySelectorAll('[data-item]').forEach((el, i) => el.classList.add(el.dataset.item === q.correctAnswers[i] ? 'ok' : 'bad')); };
    w.setOrder = (o) => { order = o.slice(); paint(); };
    return w;
  }

  // ---------- review ----------
  function viewReview(main) {
    const due = dueCards();
    const wrap = h('div', { class: 'wrap' });
    main.append(wrap);
    const deck = Object.keys(S.leitner).filter((id) => QUESTION_INDEX[id]).length;
    if (!due.length) {
      wrap.append(h('div', { class: 'card done' }, h('div', { class: 'big', 'aria-hidden': 'true' }, '✅'), h('h1', null, 'All caught up'), h('p', { class: 'muted' }, deck ? `${deck} idea${deck === 1 ? '' : 's'} in your review deck. They come back on a 1, 2, 4, 8, 16 day schedule.` : 'Missed questions will land here for spaced review.'), h('a', { class: 'btn primary', href: '#/path' }, 'Back to the path')));
      return;
    }
    const qs = due.slice(0, 15).map((e) => e.question);
    const lesson = { id: 'review', title: 'Spaced Review', description: '', questions: qs, cards: [], checkpoint: true, categoryId: due[0].category.id };
    wrap.append(h('div', { class: 'callout info', style: 'margin-bottom:12px' }, `${qs.length} due now, weakest first. Correct answers move up a box; misses go back to box 1.`));
    runSession(wrap, lesson, { onDone: () => { location.hash = '#/path'; }, doneLabel: 'Back to the path' });
  }

  // ---------- report ----------
  function reportData() {
    const lessonsTotal = CATS.reduce((n, c) => n + c.lessons.length, 0);
    const lessonsDone = Object.keys(S.completed).filter((id) => LESSON_INDEX[id]).length;
    const perCat = CATS.map((c) => { const s = S.categoryStats[c.id] || { correct: 0, total: 0 }; return { cat: c, done: completedIn(c.id), of: c.lessons.length, correct: s.correct, total: s.total, acc: s.total ? s.correct / s.total : null }; });
    const answered = perCat.filter((p) => p.total >= 3);
    const weakest = answered.length ? answered.reduce((a, b) => (a.acc <= b.acc ? a : b)) : null;
    const maxSkill = Math.max(1, ...Object.values(S.skill));
    const bigIdeas = Object.keys(DB.bigIdeas).map((k) => ({ id: k, label: DB.bigIdeas[k], points: S.skill[k] || 0, pct: Math.round(((S.skill[k] || 0) / maxSkill) * 100) }));
    const totalAnswered = perCat.reduce((n, p) => n + p.total, 0), totalCorrect = perCat.reduce((n, p) => n + p.correct, 0);
    const deck = Object.entries(S.leitner).filter(([id]) => QUESTION_INDEX[id]);
    const mastered = deck.filter(([, c]) => c.box >= 4).length;
    return { lessonsTotal, lessonsDone, perCat, weakest, bigIdeas, totalAnswered, totalCorrect, due: dueCards().length, deck: deck.length, mastered, level: levelFor(S.xp), next: nextLesson(), tickets: S.tickets.slice(-5).reverse() };
  }
  function reportText(d) {
    const lines = [`Vizancia Learning Report · ${dateKey()}`, `Learner: ${S.name || 'Learner'} · ${band().label}`, `Lessons completed: ${d.lessonsDone}/${d.lessonsTotal} · XP ${S.xp} (${d.level[1]}) · Streak ${S.streak} day(s)`, `Accuracy: ${d.totalAnswered ? Math.round((d.totalCorrect / d.totalAnswered) * 100) + '%' : 'n/a'} over ${d.totalAnswered} answers`, `Review deck: ${d.deck} ideas, ${d.mastered} in review box 4 or above, ${d.due} due now`, 'AI4K12 Big Ideas: ' + d.bigIdeas.map((b) => `${b.label} ${b.points}`).join(', ')];
    if (d.weakest) lines.push(`Weakest module: ${d.weakest.cat.name} (${Math.round(d.weakest.acc * 100)}%)`);
    if (d.next) lines.push(`Next: ${d.next.lesson.title} (${d.next.category.name})`);
    return lines.join('\n');
  }
  function viewReport(main) {
    const d = reportData();
    const wrap = h('div', { class: 'wrap report' });
    main.append(wrap);
    wrap.append(h('div', { class: 'row no-print', style: 'justify-content:space-between;margin-bottom:10px' }, h('div', { class: 'eyebrow' }, 'Learning report'), h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => copyText(reportText(d)) }, 'Copy summary'), h('button', { class: 'btn solid', onclick: () => window.print() }, 'Print / Save PDF'))));
    wrap.append(h('div', { class: 'card' },
      h('h1', null, S.name || 'Learner'),
      h('p', { class: 'muted' }, `${band().label} · ${dateKey()} · Local practice report. Review before sharing.`),
      h('div', { class: 'kpis', style: 'display:flex;gap:12px;flex-wrap:wrap' }, kpi(`${d.lessonsDone}/${d.lessonsTotal}`, 'Lessons'), kpi(`${d.totalAnswered ? Math.round((d.totalCorrect / d.totalAnswered) * 100) + '%' : '–'}`, 'Accuracy'), kpi(String(S.xp), d.level[1]), kpi(String(S.streak), 'Day streak'), kpi(`${d.mastered}/${d.deck}`, 'Review box 4+'))));
    wrap.append(h('div', { class: 'card' }, h('h2', null, 'Practice points by AI4K12 Big Idea'), h('p', { class: 'small muted' }, 'Points come from lessons and correct answers in each module tagged to that idea.'), h('div', { class: 'stack' }, d.bigIdeas.map((b) => h('div', { class: 'bar' }, h('span', null, b.label), h('span', { class: 'num' }, `${b.points} pts`), h('div', { class: 'track' }, h('i', { style: `width:${b.pct}%` })))))));
    wrap.append(h('div', { class: 'card' }, h('h2', null, 'Modules'), h('div', { style: 'overflow-x:auto' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Module'), h('th', null, 'Lessons'), h('th', null, 'Answers'), h('th', null, 'Accuracy'))), h('tbody', null, d.perCat.map((p) => h('tr', null, h('td', null, p.cat.name), h('td', { class: 'num' }, `${p.done}/${p.of}`), h('td', { class: 'num' }, String(p.total)), h('td', { class: 'num' }, p.acc == null ? '–' : `${Math.round(p.acc * 100)}%`))))))));
    wrap.append(h('div', { class: 'card' }, h('h2', null, 'What to do next'), h('ul', null,
      d.due ? h('li', null, `Review ${d.due} due idea${d.due === 1 ? '' : 's'} before starting something new.`) : h('li', null, 'The review deck is clear.'),
      d.weakest ? h('li', null, `Revisit ${d.weakest.cat.name}: accuracy there is ${Math.round(d.weakest.acc * 100)}%.`) : null,
      d.next ? h('li', null, `Next lesson: ${d.next.lesson.title} in ${d.next.category.name}.`) : h('li', null, 'Every unlocked lesson is complete. Try a Boss Challenge or ask a teacher to unlock the next tier.'))));
    if (d.tickets.length) wrap.append(h('div', { class: 'card' }, h('h2', null, 'Recent exit tickets'), h('div', { style: 'overflow-x:auto' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Lesson'), h('th', null, 'Lesson score'), h('th', null, 'Exit ticket'))), h('tbody', null, d.tickets.map((t) => h('tr', null, h('td', null, t.date), h('td', null, t.lesson), h('td', { class: 'num' }, `${t.correct}/${t.total}`), h('td', { class: 'num' }, `${t.ticketCorrect}/${t.ticketTotal}`))))))));
    wrap.append(h('p', { class: 'small muted' }, 'Vizancia Learn stores this report only in the browser it was made in. It includes the nickname, grade band and practice results. Written Explain It responses are excluded from accuracy. This is not a validated assessment. An adult can review, print or copy it to share.'));
  }
  const kpi = (v, l) => h('div', { class: 'kpi' }, h('b', null, v), h('span', null, l));

  // ---------- class period mode ----------
  function viewClass(main) {
    const cat = CAT_BY_ID[CLASS.cat];
    const wrap = h('div', { class: 'wrap' });
    main.append(wrap);
    if (!cat) { wrap.append(h('div', { class: 'card' }, h('h2', null, 'Class link not recognised'), h('p', null, 'Ask your teacher for a new link, or '), h('a', { class: 'btn solid', href: `${location.pathname}#/path` }, 'open the Learn path'))); return; }
    const lesson = (CLASS.lesson && LESSON_INDEX[CLASS.lesson] && LESSON_INDEX[CLASS.lesson].category.id === cat.id ? LESSON_INDEX[CLASS.lesson].lesson : null) || cat.lessons.find((l) => !isDone(l.id)) || cat.lessons[cat.lessons.length - 1];
    const qCount = filterQuestions(lesson.questions).length;
    const start = Date.now();
    const step = { n: 0 };
    let ticketResult = null;
    function timer() { const m = Math.floor((Date.now() - start) / 60000); return `${m} / ${CLASS.minutes} min`; }
    function intro() {
      wrap.replaceChildren(h('div', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Class period'),
        h('h1', null, cat.name),
        h('p', { class: 'muted' }, cat.description),
        h('ol', null, h('li', null, `${lesson.cards.length} teaching ideas`), h('li', null, `Lesson: ${lesson.title} (${qCount} questions)`), h('li', null, 'Exit ticket: 3 questions'), h('li', null, 'Show your summary to your teacher')),
        h('label', { class: 'f' }, 'Optional nickname (saved in this browser)', h('input', { type: 'text', id: 'cname', value: S.name, maxlength: 40, autocomplete: 'off' })),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary block', 'data-test': 'class-start', onclick: () => { S.name = ($('#cname').value || '').trim(); save(); step.n = 1; lessonStep(); } }, `Start · about ${CLASS.minutes} minutes`))));
    }
    function lessonStep() {
      wrap.replaceChildren();
      wrap.append(h('div', { class: 'row small muted', style: 'justify-content:space-between;margin-bottom:8px' }, h('span', null, `Class period · ${cat.name}`), h('span', { class: 'timer' }, timer())));
      viewLesson(wrap, lesson.id, { force: true, onExit: intro, onFinish: (r) => { step.result = r; }, onDone: ticketStep, doneLabel: 'Exit ticket' });
    }
    function ticketStep() {
      wrap.replaceChildren();
      const rng = splitmix(fnv1a64(`${cat.id}-${lesson.id}-${dateKey()}`));
      const pool = filterQuestions(lesson.questions).filter(q => q.type !== 'explain');
      const qs = shuffle(pool, rng).slice(0, Math.min(3, pool.length));
      wrap.append(h('div', { class: 'callout info', style: 'margin-bottom:12px' }, 'Exit ticket: three automatically checked practice questions. The first attempt counts; feedback and retries support learning.'));
      runSession(wrap, { id: 'ticket', title: 'Exit ticket', description: '', questions: qs, cards: [], checkpoint: true, categoryId: cat.id }, { onExit: unfinishedTicket, onFinish: (r) => { ticketResult = r; S.tickets.push({ date: dateKey(), lesson: lesson.title, correct: step.result ? step.result.correct : 0, total: step.result ? step.result.total : 0, ticketCorrect: r.correct, ticketTotal: r.total, minutes: Math.max(1, Math.round((Date.now() - start) / 60000)) }); S.tickets = S.tickets.slice(-60); save(); }, onDone: summary, doneLabel: 'Show summary' });
    }
    function unfinishedTicket() {
      wrap.replaceChildren(h('div', { class: 'card', 'data-test': 'ticket-unfinished' }, h('h1', null, 'Exit ticket unfinished'), h('p', null, 'This period is not complete. Restart the practice ticket when ready; no ticket result has been recorded.'), h('button', { class: 'btn primary', onclick: ticketStep }, 'Restart ticket')));
    }
    function summary() {
      if (!ticketResult) { unfinishedTicket(); return; }
      const r = step.result || { correct: 0, total: qCount, stars: 0 };
      const t = ticketResult || { correct: 0, total: 3 };
      const mins = Math.max(1, Math.round((Date.now() - start) / 60000));
      const text = `Vizancia class period · ${dateKey()}\n${S.name || 'Learner'} · ${cat.name}\nLesson: ${lesson.title} · ${r.correct}/${r.total} first try · ${r.stars} star(s)\nExit ticket: ${t.correct}/${t.total}\nTime: ${mins} min`;
      wrap.replaceChildren(h('div', { class: 'card done', 'data-test': 'class-summary' },
        h('div', { class: 'big', 'aria-hidden': 'true' }, '🎟️'),
        h('h1', null, 'Period complete'),
        h('p', { class: 'muted' }, `${S.name || 'Learner'} · ${cat.name} · ${dateKey()}`),
        h('div', { class: 'kpis' }, kpi(`${r.correct}/${r.total}`, lesson.title), kpi(`${t.correct}/${t.total}`, 'Exit ticket'), kpi(String(mins), 'Minutes')),
        h('p', { class: 'small muted' }, 'Show this screen to your teacher, or copy the summary.'),
        h('div', { class: 'actions', style: 'justify-content:center' }, h('button', { class: 'btn ghost', onclick: () => copyText(text) }, 'Copy summary'), h('button', { class: 'btn ghost', onclick: () => window.print() }, 'Print'), h('a', { class: 'btn primary', href: `${location.pathname}#/path` }, 'Keep learning'))));
    }
    intro();
  }

  // ---------- teacher page ----------
  function viewTeacher(main) {
    const wrap = h('div', { class: 'wide' });
    main.append(wrap);
    const base = location.origin + location.pathname;
    const form = { cat: CATS[0].id, lesson: '', minutes: 20, band: 'middle' };
    const link = () => { const p = new URLSearchParams({ class: form.cat, minutes: String(form.minutes), band: form.band }); if (form.lesson) p.set('lesson', form.lesson); return `${base}?${p.toString()}`; };
    const linkBox = h('div', { class: 'linkbox', id: 'classlink' }, link());
    const preview = h('a', { class: 'btn ghost', href: link(), target: '_blank', rel: 'noopener' }, 'Preview');
    const lessonSel = h('select', { id: 't-lesson', onchange: (e) => { form.lesson = e.target.value; refresh(); } });
    const fillLessons = () => { lessonSel.replaceChildren(h('option', { value: '' }, 'Next incomplete lesson for each learner'), ...CAT_BY_ID[form.cat].lessons.map((l) => h('option', { value: l.id }, l.title))); };
    fillLessons();
    const refresh = () => { linkBox.textContent = link(); preview.href = link(); };
    const left = h('div', null,
      h('div', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Teacher'),
        h('h1', null, 'Run a class period'),
        h('p', null, 'Build a link, put it on the board, and every learner gets the same sequence: teaching ideas, one lesson, a three-question exit ticket, and a summary screen to show you. Nothing is collected; each device keeps its own progress.'),
        h('div', { class: 'stack' },
          h('label', { class: 'f' }, 'Module', h('select', { onchange: (e) => { form.cat = e.target.value; form.lesson = ''; fillLessons(); refresh(); } }, CATS.map((c) => h('option', { value: c.id }, `${TIER_NAMES[TIER_OF(c)]} · ${c.name}`)))),
          h('label', { class: 'f' }, 'Lesson', lessonSel),
          h('div', { class: 'row' },
            h('label', { class: 'f', style: 'flex:1' }, 'Minutes', h('select', { onchange: (e) => { form.minutes = Number(e.target.value); refresh(); } }, [10, 15, 20, 25, 30, 45].map((m) => h('option', { value: m, selected: m === 20 }, `${m}`)))),
            h('label', { class: 'f', style: 'flex:1' }, 'Grade band', h('select', { onchange: (e) => { form.band = e.target.value; refresh(); } }, BANDS.map((b) => h('option', { value: b.id, selected: b.id === 'middle' }, b.label))))),
          h('div', null, h('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Class link'), linkBox),
          h('div', { class: 'actions' }, h('button', { class: 'btn solid', onclick: () => copyText(link()) }, 'Copy link'), preview))),
      h('div', { class: 'card' }, h('h2', null, 'How a period runs'), h('ol', null,
        h('li', null, 'Share or project the class link. Learners open it on any device with a browser, including Chromebooks. No sign-in.'),
        h('li', null, 'Learners can use a nickname. It stays in this browser profile and appears on the summary. Leave out identifying details.'),
        h('li', null, 'They read the teaching ideas, complete the lesson, then take the exit ticket.'),
        h('li', null, 'Collect evidence by walking the room: each summary screen shows name, lesson score, exit ticket score, and minutes. Learners can also copy or print it.'),
        h('li', null, 'Learners can open Report any time for a printable Learning Report by AI4K12 Big Idea.'))),
      h('div', { class: 'card' }, h('h2', null, 'Modules and standards'), h('div', { style: 'overflow-x:auto' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Tier'), h('th', null, 'Module'), h('th', null, 'Lessons'), h('th', null, 'AI4K12 Big Ideas'))), h('tbody', null, CATS.map((c) => h('tr', null, h('td', null, TIER_NAMES[TIER_OF(c)]), h('td', null, h('b', null, c.name), h('div', { class: 'small muted' }, c.lessons.map((l) => l.title).join(' · '))), h('td', { class: 'num' }, String(c.lessons.length)), h('td', null, c.bigIdeas.map((b) => DB.bigIdeas[b]).join(', ')))))))));
    const right = h('aside', null,
      h('div', { class: 'card' }, h('h3', null, 'Privacy in one paragraph'), h('p', { class: 'small' }, 'Vizancia Learn is a static page. It makes no network requests after it loads, has no accounts, and stores progress only in the browser that used it. There is no chatbot and no AI service behind it; every simulated reply is written by people. Follow school approval, privacy and device rules before classroom use. This browser player saves progress; it does not provide the iOS app’s temporary Classroom Mode. Anyone using this browser profile may read the records. Hosted page access contacts the website host.')),
      h('div', { class: 'card' }, h('h3', null, 'Grade bands'), h('p', { class: 'small' }, 'Grades K-2 and 3-5 have distinct quick practice activities and shorter lesson wording. Grades 6-8 add intermediate questions. Grades 9-12 and adults see everything. Teachers can unlock all content in Settings on any device.')),
      h('div', { class: 'card' }, h('h3', null, 'Also available'), h('p', { class: 'small' }, 'The iPad and iPhone app adds Prompt Lab, Train the Robot, AI Startup, and the Campus world. ', h('a', { href: '../trust/' }, 'Can we trust this? classroom project'))));
    wrap.append(left, right);
  }
  function viewAbout(main) {
    main.append(h('div', { class: 'wrap' }, h('div', { class: 'card' }, h('h1', null, 'About Vizancia Learn'),
      h('p', null, 'Vizancia teaches learners about AI. It does not put an AI friend in their pocket. There is no chatbot or AI companion here; every simulated reply is written by people for learning.'),
      h('p', null, `This web player carries the same ${CATS.reduce((n, c) => n + c.lessons.length, 0)} lessons and ${Object.keys(QUESTION_INDEX).length} questions as the iOS app, with grade-band filtering, tier unlocks, stable browser checkpoints, and spaced review. Checkpoint permutations and browser storage differ from the native app. It runs entirely in your browser and stores progress only on this device.`),
      h('p', null, 'The iPad and iPhone app adds Prompt Lab, Train the Robot, AI Startup, and the Campus world.'),
      h('p', { class: 'small muted' }, `Version ${APP_VERSION} · `, h('a', { href: '../privacy-policy.html' }, 'Privacy policy'), ' · ', h('a', { href: '../support.html' }, 'Support')))));
  }

  // ---------- settings sheet ----------
  function openSettings() {
    const bg = h('div', { class: 'sheet-bg', onclick: (e) => { if (e.target === bg) close(); } });
    const close = () => bg.remove();
    const nameIn = h('input', { type: 'text', value: S.name, maxlength: 40, autocomplete: 'off' });
    const bandSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Grade band' }, BANDS.map((b) => h('button', { 'aria-pressed': S.band === b.id ? 'true' : 'false', onclick: () => { S.band = b.id; save(); bandSeg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x.textContent === b.label ? 'true' : 'false')); } }, b.label)));
    const unlock = h('input', { type: 'checkbox', checked: S.teacherUnlock, onchange: (e) => { S.teacherUnlock = e.target.checked; save(); } });
    const exportBox = h('textarea', { readonly: true, 'aria-label': 'Progress export' }, JSON.stringify(S));
    const importBox = h('textarea', { placeholder: 'Paste a progress export here', 'aria-label': 'Progress import' });
    bg.append(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', null, 'Settings'), h('button', { class: 'btn ghost', onclick: () => { S.name = nameIn.value.trim(); save(); close(); render(); } }, 'Done')),
      h('div', { class: 'stack' },
        h('label', { class: 'f' }, 'Name shown on reports (stays on this device)', nameIn),
        h('div', null, h('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Grade band'), bandSeg),
        h('label', { class: 'row' }, unlock, ' Teacher: unlock every tier and difficulty on this device'),
        h('details', null, h('summary', null, 'Move progress to another device'), h('p', { class: 'small muted' }, 'Copy the export, paste it into Settings on the other device, then Import.'), exportBox, h('button', { class: 'btn ghost', onclick: () => copyText(exportBox.value) }, 'Copy export'), importBox, h('button', { class: 'btn ghost', onclick: () => { try { const j = JSON.parse(importBox.value); if (j && j.v === 1) { S = Object.assign(defaultState(), j); save(); close(); render(); toast('Progress imported'); } else toast('That is not a Vizancia export'); } catch (e) { toast('Could not read that export'); } } }, 'Import')),
        h('button', { class: 'btn ghost', style: 'color:var(--error)', onclick: () => { if (confirm('Erase all progress on this device?')) { resetProgress(); close(); render(); } } }, 'Reset all progress'))));
    $('#sheet-root').append(bg);
    nameIn.focus();
  }

  // ---------- self test (?smoke=1) ----------
  async function smoke() {
    const out = [];
    const ok = (name, cond) => out.push(`${cond ? 'PASS' : 'FAIL'} ${name}`);
    const tick = () => new Promise((r) => setTimeout(r, 0));
    try {
      resetProgress(); S.band = 'middle'; save();
      ok('content loaded', CATS.length === 17 && Object.keys(QUESTION_INDEX).length >= 610);
      const cp1 = checkpointLesson(CAT_BY_ID.ai_basics, false).questions.map((q) => q.id).join(',');
      const cp2 = checkpointLesson(CAT_BY_ID.ai_basics, false).questions.map((q) => q.id).join(',');
      ok('checkpoint deterministic', cp1 === cp2);
      ok('checkpoint samples two per covered lesson', cp1.split(',').length === 6);
      const boss = checkpointLesson(CAT_BY_ID.ai_basics, true).questions.length;
      ok('boss caps at ten', boss === 10);
      ok('tier 2 locked initially', isLocked(CAT_BY_ID.how_ai_learns));
      location.hash = '#/lesson/ab_l1'; render(); await tick();
      const lesson = LESSON_INDEX.ab_l1.lesson;
      let guard = 0;
      while ($('[data-test="next"]') && guard++ < 20) { $('[data-test="next"]').click(); await tick(); }
      ok('cards advanced', !!$('[data-qid]'));
      guard = 0;
      while ($('[data-qid]') && guard++ < 60) {
        const card = $('[data-qid]'); const q = QUESTION_INDEX[card.dataset.qid].question;
        if (q.type === 'matchPairs') { for (const p of q.pairs) { card.querySelector(`[data-term="${CSS.escape(p.term)}"]`).click(); await tick(); card.querySelector(`[data-def="${CSS.escape(p.definition)}"]`).click(); await tick(); } }
        else if (q.type === 'sortOrder') { for (let pass = 0; pass < q.options.length; pass++) for (let i = 0; i < q.correctAnswers.length; i++) { const items = [...card.querySelectorAll('[data-item]')]; const idx = items.findIndex((el) => el.dataset.item === q.correctAnswers[i]); if (idx > i) { items[idx].querySelector('button[aria-label^="Move"][aria-label$="up"]').click(); await tick(); } } }
        else if (q.type === 'explain') { const ta = card.querySelector('[data-explain]'); ta.value = 'It predicts likely words from patterns and does not think.'; ta.dispatchEvent(new Event('input')); await tick(); }
        else { card.querySelector(`[data-opt="${CSS.escape(q.correct)}"]`).click(); await tick(); }
        const beforeExplain = JSON.stringify({stats:S.categoryStats, card:S.leitner[q.id]});
        $('[data-test="check"]').click(); await tick();
        if(q.type === 'explain') ok('writing does not auto-score or promote review', beforeExplain === JSON.stringify({stats:S.categoryStats,card:S.leitner[q.id]}));
        ok(`answered ${q.id}`, !!$('.feedback') && !$('.feedback.bad'));
        $('[data-test="continue"]').click(); await tick();
      }
      ok('lesson done screen', !!$('[data-test="done"]'));
      ok('3 stars recorded', S.completed.ab_l1 && S.completed.ab_l1.stars === 3);
      const expectedQs = filterQuestions(lesson.questions).filter(q => q.type !== "explain").length;
      ok('xp awarded', S.xp === expectedQs * 15 + 25 + 50);
      ok('streak 1', S.streak === 1);
      ok('accuracy excludes written attempts', S.categoryStats.ai_basics.total === expectedQs && S.completed.ab_l1.total === expectedQs);
      // Leitner
      leitnerAdd('ab1_q1'); ok('due after miss', dueCards().length === 1); leitnerRecord('ab1_q1', true); ok('not due after correct today', dueCards().length === 0 && S.leitner.ab1_q1.box === 2);
      // report
      location.hash = '#/report'; render(); await tick(); ok('report renders', /Learning report/i.test($('#main').textContent) && $('#main').textContent.includes('1/106'));
      // teacher
      location.hash = '#/teacher'; render(); await tick(); ok('teacher renders', $('#classlink') && $('#classlink').textContent.includes('class=ai_basics'));
      const teacherSelects = [...document.querySelectorAll('select')]; teacherSelects[0].selectedIndex = 1; teacherSelects[0].dispatchEvent(new Event('change')); await tick();
      ok('teacher preview follows selected settings', document.querySelector('a[target="_blank"]').href === $('#classlink').textContent);
      // every question renders without throwing
      let rendered = 0;
      for (const id of Object.keys(QUESTION_INDEX)) { const card = h('div'); buildWidget(QUESTION_INDEX[id].question, card); if (card.querySelector('.stem')) rendered++; }
      const beforePractice = JSON.stringify(S);
      location.hash = '#/practice/route_middle_check'; render(); await tick();
      ok('practice exposes evidence', !!$('[data-test="practice-evidence"]'));
      for (const q of DB.guidedPractices.find(p => p.id === 'route_middle_check').questions) {
        $('[data-practice-opt="' + CSS.escape(q.correct) + '"]').click(); await tick();
        $('[data-test="practice-next"]').click(); await tick();
      }
      ok('practice reaches reflection', $('#main').textContent.includes('What will you try next?'));
      ok('practice changes no learning records or rewards', beforePractice === JSON.stringify(S));
      ok('all questions render', rendered === Object.keys(QUESTION_INDEX).length);
      const explainIds = Object.keys(QUESTION_INDEX).filter((id) => QUESTION_INDEX[id].question.type === 'explain');
      ok('explain items have model answer and rubric', explainIds.every((id) => QUESTION_INDEX[id].question.correct && QUESTION_INDEX[id].question.options.length >= 2));
    } catch (e) { out.push(`FAIL exception ${e && e.stack ? e.stack : e}`); }
    const pre = $('#smoke'); pre.hidden = false; pre.textContent = out.join('\n');
  }

  // ---------- boot ----------
  window.VizanciaLearn = { state: () => S, render, checkpointLesson, filterQuestions };
  render();
  if (params.get('smoke') === '1') smoke();
})();
