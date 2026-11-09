(() => {
  'use strict';

  const DATA = window.N1NEW;
  if (!DATA || !Array.isArray(DATA.questions) || !DATA.questions.length) {
    const main = document.querySelector('.main');
    if (main) {
      main.innerHTML = '<div class="card"><h1 class="card-title">题库加载失败</h1><p class="hint">请确认 data.js 与 index.html 位于同一目录。</p></div>';
    }
    return;
  }

  const QUESTIONS = DATA.questions;
  const MODULES = DATA.meta.modules || [];
  const TOTAL = QUESTIONS.length;
  const DAILY_SIZE = DATA.meta.dailySize || 20;
  const DAILY_WEIGHTS = { ordering: 4, grammar: 6, adverb: 3, vocab: 5, synonym: 2 };

  const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
  const moduleById = new Map(MODULES.map((m) => [m.id, m]));
  const questionModule = new Map(QUESTIONS.map((q) => [q.id, q.module]));

  const K = {
    progress: 'n1new.progress.v1',
    daily: 'n1new.daily.v1',
    wrong: 'n1new.wrong.v1',
    session: 'n1new.session.v1',
    settings: 'n1new.settings.v1',
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const checkIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>';
  const xIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>';
  const bookIcon = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z"></path></svg>';

  function moduleIconSvg(id) {
    const paths = {
      ordering: '<path d="M4 6h9M4 12h9M4 18h9M17 4v16m0-16-3 3m3-3 3 3"></path>',
      grammar: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13Z"></path><path d="M8 3v18"></path>',
      adverb: '<circle cx="12" cy="12" r="3"></circle><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"></path>',
      vocab: '<path d="M4 4h16v16H4z"></path><path d="M8 8h8M8 12h8M8 16h5"></path>',
      synonym: '<path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3"></path>',
    };
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id] || paths.grammar}</svg>`;
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const value = JSON.parse(raw);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore storage failures */
    }
  }

  function defaultProgress() {
    return { records: {}, totalAttempts: 0, totalCorrect: 0, days: {}, recent: [], sessions: [] };
  }

  const storedProgress = load(K.progress, {});
  let progress = {
    ...defaultProgress(),
    ...storedProgress,
    records: storedProgress && typeof storedProgress.records === 'object' && storedProgress.records ? storedProgress.records : {},
    days: storedProgress && typeof storedProgress.days === 'object' && storedProgress.days ? storedProgress.days : {},
    recent: storedProgress && Array.isArray(storedProgress.recent) ? storedProgress.recent : [],
    sessions: storedProgress && Array.isArray(storedProgress.sessions) ? storedProgress.sessions : [],
  };

  let wrong = load(K.wrong, {});
  if (!wrong || typeof wrong !== 'object' || Array.isArray(wrong)) wrong = {};
  let daily = load(K.daily, null);
  let session = load(K.session, null);
  let settings = load(K.settings, { theme: 'dark' });
  if (!settings || typeof settings !== 'object') settings = { theme: 'dark' };

  let pending = null;
  let currentView = 'home';
  let resultState = null;
  let toastTimer = 0;

  // ----------------------------------------------------------------
  // helpers
  // ----------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, '0');

  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function monthDay(date = new Date()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
    if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function formatDateTime(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatDuration(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function formatStem(text) {
    return escapeHtml(text).replace(/（[\s\u3000]*）/g, '<span class="blank">（　）</span>');
  }

  function renderStem(q) {
    if (q.module === 'ordering') {
      return escapeHtml(q.stem)
        .replace(/＿＿＿＿/g, '<span class="order-blank"></span>')
        .replace(/★/g, '<span class="order-star">★</span>');
    }
    let html = escapeHtml(q.stem);
    if (q.type === '問題3' && q.target) {
      const index = html.indexOf(q.target);
      if (index >= 0) {
        html = `${html.slice(0, index)}<span class="target-word">${q.target}</span>${html.slice(index + q.target.length)}`;
      }
    }
    return html.replace(/（[\s\u3000]*）/g, '<span class="blank">（　）</span>');
  }

  function previewStem(q) {
    let text = q.stem.replace(/＿＿＿＿/g, '…').replace(/★/g, '★');
    if (text.length > 130) text = `${text.slice(0, 130)}…`;
    return text;
  }

  function moduleName(id) {
    return (moduleById.get(id) && moduleById.get(id).name) || '练习';
  }

  function modeLabel(mode, moduleId) {
    if (mode === 'daily') return '每日练习';
    if (mode === 'wrong') return '错题复习';
    if (mode === 'mixed') return '综合练习';
    return moduleName(moduleId);
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let value = seed;
    return function random() {
      value |= 0;
      value = (value + 0x6d2b79f5) | 0;
      let t = Math.imul(value ^ (value >>> 15), 1 | value);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(items, random = Math.random) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
  }

  function attemptedCount() {
    return Object.keys(progress.records).length;
  }

  function accuracy() {
    if (!progress.totalAttempts) return null;
    return Math.round((progress.totalCorrect / progress.totalAttempts) * 100);
  }

  function wrongCount() {
    return Object.keys(wrong).length;
  }

  function questionsOfModule(moduleId) {
    return QUESTIONS.filter((q) => q.module === moduleId);
  }

  function moduleDone(moduleId) {
    let count = 0;
    Object.keys(progress.records).forEach((id) => {
      if (questionModule.get(id) === moduleId) count += 1;
    });
    return count;
  }

  // ----------------------------------------------------------------
  // daily set
  // ----------------------------------------------------------------

  function makeDailyIds(key) {
    const rng = mulberry32(hashString(`n1new-${key}`));
    const picked = [];
    MODULES.forEach((m) => {
      const pool = shuffle(
        questionsOfModule(m.id).map((q) => q.id),
        mulberry32(hashString(`n1new-${key}-${m.id}`)),
      );
      picked.push(...pool.slice(0, DAILY_WEIGHTS[m.id] || 0));
    });

    let ids = Array.from(new Set(picked));
    if (ids.length < DAILY_SIZE) {
      const rest = shuffle(
        QUESTIONS.map((q) => q.id).filter((id) => !ids.includes(id)),
        rng,
      );
      ids.push(...rest.slice(0, DAILY_SIZE - ids.length));
    }
    return shuffle(ids.slice(0, DAILY_SIZE), rng);
  }

  function ensureDaily() {
    const today = dateKey();
    const invalid = !daily
      || daily.date !== today
      || !Array.isArray(daily.ids)
      || daily.ids.length !== DAILY_SIZE
      || daily.ids.some((id) => !byId.has(id));

    if (invalid) {
      daily = { date: today, ids: makeDailyIds(today), answers: {}, completedAt: null };
      save(K.daily, daily);
    }
    if (!daily.answers || typeof daily.answers !== 'object') daily.answers = {};
    return daily;
  }

  function dailyStats() {
    const d = ensureDaily();
    const entries = Object.entries(d.answers);
    let correct = 0;
    entries.forEach(([id, selection]) => {
      const q = byId.get(id);
      if (q && selection === q.answer) correct += 1;
    });
    return { done: entries.length, correct, accuracy: entries.length ? Math.round((correct / entries.length) * 100) : null };
  }

  // ----------------------------------------------------------------
  // storage / sanitising
  // ----------------------------------------------------------------

  function saveProgress() { save(K.progress, progress); }
  function saveWrong() { save(K.wrong, wrong); }
  function saveSession() { save(K.session, session); }

  Object.keys(wrong).forEach((id) => {
    if (!byId.has(id)) delete wrong[id];
  });
  Object.keys(progress.records).forEach((id) => {
    if (!byId.has(id)) delete progress.records[id];
  });

  if (session) {
    if (!Array.isArray(session.ids)) {
      session = null;
    } else {
      session.ids = session.ids.filter((id) => byId.has(id));
      if (!session.ids.length) session = null;
    }
  }
  if (session && (session.finished || (session.mode === 'daily' && session.date !== dateKey()))) {
    session = null;
  }

  // ----------------------------------------------------------------
  // records
  // ----------------------------------------------------------------

  function recordAnswer(q, selection, mode) {
    const now = Date.now();
    const ok = selection === q.answer;
    const rec = progress.records[q.id] || { attempts: 0, correct: 0, wrong: 0 };
    rec.attempts += 1;
    if (ok) rec.correct += 1;
    else rec.wrong += 1;
    rec.lastAt = now;
    progress.records[q.id] = rec;

    progress.totalAttempts += 1;
    if (ok) progress.totalCorrect += 1;

    const key = dateKey();
    const day = progress.days[key] || { attempts: 0, correct: 0 };
    day.attempts += 1;
    if (ok) day.correct += 1;
    progress.days[key] = day;

    progress.recent.unshift({ id: q.id, sel: selection, ok, at: now, mode, module: q.module });
    progress.recent = progress.recent.slice(0, 50);

    if (!ok) {
      wrong[q.id] = {
        count: (wrong[q.id] && wrong[q.id].count ? wrong[q.id].count : 0) + 1,
        lastAt: now,
        sel: selection,
      };
    } else if (mode === 'wrong') {
      delete wrong[q.id];
    }

    saveProgress();
    saveWrong();
    return ok;
  }

  // ----------------------------------------------------------------
  // session lifecycle
  // ----------------------------------------------------------------

  function currentQuestion() {
    if (!session) return null;
    return byId.get(session.ids[session.index]) || null;
  }

  function nextAvailableIndex() {
    if (!session) return 0;
    let index = session.index + 1;
    while (index < session.ids.length && session.answers[session.ids[index]] != null) index += 1;
    return index;
  }

  function beginSession(mode, ids, moduleId = null, answers = {}, index = 0) {
    if (!ids.length) {
      toast('没有可练习的题目');
      return;
    }
    session = {
      mode,
      module: moduleId,
      ids: ids.slice(),
      index,
      answers: { ...answers },
      startedAt: Date.now(),
      roundSize: ids.length,
      date: mode === 'daily' ? ensureDaily().date : null,
      finished: false,
    };
    pending = null;
    saveSession();
    showView('quiz');
  }

  function startModule(moduleId) {
    const pool = questionsOfModule(moduleId);
    if (!pool.length) {
      toast('该模块暂时没有题目');
      return;
    }
    const ids = shuffle(pool.map((q) => q.id)).slice(0, Math.min(20, pool.length));
    beginSession('module', ids, moduleId);
  }

  function startDaily() {
    const d = ensureDaily();
    const done = Object.keys(d.answers).length;
    if (done >= DAILY_SIZE) {
      toast('今天的 20 题已经完成，去模块练习加练吧');
      return;
    }
    const answers = { ...d.answers };
    let index = d.ids.findIndex((id) => answers[id] == null);
    if (index < 0) index = 0;
    beginSession('daily', d.ids, null, answers, index);
  }

  function startWrong() {
    const ids = shuffle(Object.keys(wrong).filter((id) => byId.has(id))).slice(0, 100);
    if (!ids.length) {
      toast('错题本还是空的');
      return;
    }
    beginSession('wrong', ids);
  }

  function startMixed() {
    const ids = shuffle(QUESTIONS.map((q) => q.id)).slice(0, Math.min(20, TOTAL));
    beginSession('mixed', ids);
  }

  function submitCurrent(selection) {
    if (!session) return;
    const q = currentQuestion();
    if (!q || session.answers[q.id] != null) return;

    recordAnswer(q, selection, session.mode);
    session.answers[q.id] = selection;

    if (session.mode === 'daily') {
      const d = ensureDaily();
      d.answers[q.id] = selection;
      if (Object.keys(d.answers).length >= d.ids.length) d.completedAt = Date.now();
      save(K.daily, d);
    }

    saveSession();
    pending = null;
    renderQuiz();
    updateGlobalBadges();
  }

  function nextQuestion() {
    if (!session) return;
    const next = nextAvailableIndex();
    if (next >= session.ids.length) {
      finishSession();
      return;
    }
    session.index = next;
    pending = null;
    saveSession();
    renderQuiz();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function finishSession() {
    if (!session || session.finished) return;

    const answeredIds = Object.keys(session.answers);
    const answered = answeredIds.length;
    let correct = 0;
    answeredIds.forEach((id) => {
      const q = byId.get(id);
      if (q && session.answers[id] === q.answer) correct += 1;
    });

    const duration = Date.now() - session.startedAt;
    session.finished = true;
    saveSession();

    progress.sessions.unshift({
      at: Date.now(),
      mode: session.mode,
      module: session.module,
      total: session.ids.length,
      answered,
      correct,
      duration,
    });
    progress.sessions = progress.sessions.slice(0, 30);
    saveProgress();

    resultState = {
      mode: session.mode,
      module: session.module,
      total: session.ids.length,
      answered,
      correct,
      duration,
      ids: session.ids.slice(),
      answers: { ...session.answers },
    };

    showView('result');
  }

  // ----------------------------------------------------------------
  // views
  // ----------------------------------------------------------------

  function showView(name) {
    if (name === 'quiz' && (!session || session.finished)) name = 'home';
    if (name === 'result' && !resultState) name = 'home';

    currentView = name;
    $$('.view').forEach((view) => { view.hidden = true; });
    const target = $(`#view-${name}`);
    if (target) target.hidden = false;

    $$('.nav-btn').forEach((button) => {
      const nav = button.dataset.nav;
      const active = (nav === 'home' && name === 'home')
        || (nav === 'wrong' && name === 'wrong')
        || (nav === 'history' && name === 'history');
      button.classList.toggle('is-active', active);
    });

    if (name === 'home') renderHome();
    if (name === 'quiz') renderQuiz();
    if (name === 'result') renderResult();
    if (name === 'wrong') renderWrongBook();
    if (name === 'history') renderHistory();

    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function updateGlobalBadges() {
    const badge = $('#navWrongBadge');
    if (badge) badge.textContent = String(wrongCount());
  }

  function emptyState(text, sub, icon = bookIcon) {
    return `<div class="empty-state">${icon}<p>${text}</p>${sub ? `<span>${sub}</span>` : ''}</div>`;
  }

  function recentHtml(items, limit) {
    if (!items.length) {
      return emptyState('从第一道题开始，积累你的学习足迹。', '进度与每次交卷成绩自动保存');
    }
    return items.slice(0, limit).map((item) => {
      const q = byId.get(item.id);
      if (!q) return '';
      return `<div class="recent-item">
        <span class="recent-icon ${item.ok ? 'ok' : 'bad'}">${item.ok ? checkIcon : xIcon}</span>
        <div class="recent-main">
          <strong>${escapeHtml(moduleName(q.module))}${q.point ? ` · ${escapeHtml(q.point)}` : ''}</strong>
          <span>${escapeHtml(previewStem(q))}</span>
        </div>
        <span class="recent-time">${timeAgo(item.at)}</span>
      </div>`;
    }).join('');
  }

  function moduleCardHtml(m) {
    const done = moduleDone(m.id);
    const pct = m.count ? Math.round((done / m.count) * 100) : 0;
    return `<button type="button" class="module-card" data-module="${m.id}" aria-label="开始${m.name}练习">
      <span class="module-card-top">
        <span class="module-icon">${moduleIconSvg(m.id)}</span>
        <span class="module-count">${m.count} 题 <span class="module-arrow">→</span></span>
      </span>
      <span class="module-name">${m.name}</span>
      <span class="module-desc">${m.desc}</span>
      <span class="module-progress">
        <span class="track"><span class="fill" style="width:${pct}%"></span></span>
        <em>${done}/${m.count}</em>
      </span>
    </button>`;
  }

  function renderHome() {
    ensureDaily();

    const attempted = attemptedCount();
    const acc = accuracy();
    const wc = wrongCount();

    if ($('#homeTotalText')) $('#homeTotalText').textContent = String(TOTAL);
    if ($('#homeTotal')) $('#homeTotal').textContent = String(TOTAL);
    if ($('#homeAttempted')) $('#homeAttempted').textContent = String(attempted);
    if ($('#homeProgress')) {
      $('#homeProgress').max = TOTAL;
      $('#homeProgress').value = attempted;
    }
    if ($('#homeStatAttempted')) {
      $('#homeStatAttempted').textContent = String(attempted);
      const small = $('#homeStatAttempted').parentElement.querySelector('small');
      if (small) small.textContent = `/ ${TOTAL}`;
    }
    if ($('#homeStatAccuracy')) $('#homeStatAccuracy').textContent = acc == null ? '—' : `${acc}%`;
    if ($('#homeStatWrong')) $('#homeStatWrong').textContent = String(wc);

    const grid = $('#moduleGrid');
    if (grid) grid.innerHTML = MODULES.map(moduleCardHtml).join('');

    const recent = $('#recentList');
    if (recent) recent.innerHTML = recentHtml(progress.recent, 4);

    renderDailyCard();
    renderResume();
    updateGlobalBadges();
  }

  function renderDailyCard() {
    const stats = dailyStats();
    if ($('#dailyDone')) $('#dailyDone').textContent = String(stats.done);
    if ($('#dailyProgress')) {
      $('#dailyProgress').max = DAILY_SIZE;
      $('#dailyProgress').value = stats.done;
    }
    if ($('#dailyDate')) $('#dailyDate').textContent = monthDay();

    const button = $('#dailyStartBtn');
    const note = $('#dailyNote');
    if (stats.done >= DAILY_SIZE) {
      if (note) note.textContent = `今日已完成 · 正确率 ${stats.accuracy}%`;
      if (button) {
        button.disabled = true;
        button.textContent = '今日已完成';
      }
    } else {
      if (note) {
        note.textContent = stats.done > 0
          ? `已答 ${stats.done} 题 · 正确 ${stats.correct} 题`
          : '每天 20 题，混合 5 个模块。';
      }
      if (button) {
        button.disabled = false;
        button.textContent = stats.done > 0
          ? `继续今日练习（还剩 ${DAILY_SIZE - stats.done} 题）`
          : '开始今日练习';
      }
    }
  }

  function renderResume() {
    const banner = $('#resumeBanner');
    if (!banner) return;
    const resumable = session && !session.finished && session.ids && session.ids.length;
    banner.hidden = !resumable;
    if (resumable && $('#resumeText')) {
      $('#resumeText').textContent = `${modeLabel(session.mode, session.module)} · 已答 ${Object.keys(session.answers).length}/${session.ids.length}`;
    }
  }

  function promptText(q) {
    if (q.module === 'ordering') return '★位置应填入哪一项？';
    if (q.type === '問題3') return `与句中「${q.target}」意思最接近的是？`;
    if (q.module === 'vocab' || q.module === 'synonym') return '';
    if (q.stem.includes('（　）')) return '空栏中应填入哪一项？';
    return '哪一项最适合这段对话？';
  }

  function renderQuiz() {
    if (!session) {
      showView('home');
      return;
    }

    const total = session.ids.length;
    if (session.index >= total) {
      finishSession();
      return;
    }

    const q = currentQuestion();
    if (!q) {
      showView('home');
      return;
    }

    const submitted = session.answers[q.id] != null;
    const selected = submitted ? session.answers[q.id] : pending;
    const answeredIds = Object.keys(session.answers);
    const answered = answeredIds.length;
    let correct = 0;
    answeredIds.forEach((id) => {
      const item = byId.get(id);
      if (item && session.answers[id] === item.answer) correct += 1;
    });

    if ($('#quizModuleChip')) $('#quizModuleChip').textContent = moduleName(q.module);
    if ($('#quizSource')) $('#quizSource').textContent = `${q.source}${q.point ? ` · ${q.point}` : ''}`;
    if ($('#quizStep')) $('#quizStep').textContent = `第 ${session.index + 1} / ${total} 题`;
    if ($('#quizPercent')) $('#quizPercent').textContent = `${Math.round((answered / total) * 100)}%`;
    if ($('#quizProgress')) {
      $('#quizProgress').max = total;
      $('#quizProgress').value = answered;
    }

    const prompt = promptText(q);
    if ($('#quizPrompt')) {
      $('#quizPrompt').textContent = prompt;
      $('#quizPrompt').hidden = !prompt;
    }
    if ($('#stem')) $('#stem').innerHTML = renderStem(q);

    const options = $('#options');
    if (options) {
      options.innerHTML = q.options.map((text, index) => {
        let className = 'option';
        let mark = '';
        if (submitted) {
          if (index === q.answer) {
            className += ' is-correct';
            mark = `<span class="option-mark">${checkIcon}</span>`;
          } else if (index === selected) {
            className += ' is-wrong';
            mark = `<span class="option-mark">${xIcon}</span>`;
          } else {
            className += ' is-dim';
          }
        } else if (index === pending) {
          className += ' is-selected';
        }
        return `<button type="button" class="${className}" data-index="${index}" role="radio" aria-checked="${selected === index}" ${submitted ? 'disabled' : ''}>
          <span class="opt-key">${index + 1}</span>
          <span class="opt-text">${escapeHtml(text)}</span>
          ${mark}
        </button>`;
      }).join('');
    }

    const feedback = $('#feedback');
    if (feedback) {
      if (submitted) {
        const ok = selected === q.answer;
        let extra = ok ? '' : ' · 已加入错题本';
        if (ok && session.mode === 'wrong') extra = ' · 已移出错题本';
        let detail = `${ok ? '答案' : '正确答案'}：${(ok ? selected : q.answer) + 1}. ${escapeHtml(q.options[ok ? selected : q.answer])}${extra}`;
        if (q.module === 'ordering') {
          detail += `<span class="feedback-extra">正确顺序：${q.order.join(' → ')}</span>`;
        }
        feedback.hidden = false;
        feedback.className = `feedback ${ok ? 'ok' : 'bad'}`;
        feedback.innerHTML = `<span class="feedback-icon">${ok ? checkIcon : xIcon}</span>
          <div>
            <strong>${ok ? '回答正确' : '回答错误'}</strong>
            <p>${detail}</p>
          </div>`;
      } else {
        feedback.hidden = true;
        feedback.innerHTML = '';
      }
    }

    const submit = $('#submitBtn');
    if (submit) {
      const hasNext = nextAvailableIndex() < total;
      submit.disabled = !submitted && pending == null;
      submit.textContent = submitted ? (hasNext ? '下一题' : '查看结果') : '提交答案';
    }

    if ($('#sessionDone')) $('#sessionDone').textContent = String(answered);
    if ($('#sessionTotal')) $('#sessionTotal').textContent = String(total);
    if ($('#sessionCorrect')) $('#sessionCorrect').textContent = String(correct);
    if ($('#sessionWrong')) $('#sessionWrong').textContent = String(answered - correct);
    if ($('#sessionModeChip')) $('#sessionModeChip').textContent = `${total} 题`;

    const attempted = attemptedCount();
    if ($('#quizAttempted')) $('#quizAttempted').textContent = String(attempted);
    if ($('#quizTotal')) $('#quizTotal').textContent = String(TOTAL);
    if ($('#quizTotalProgress')) {
      $('#quizTotalProgress').max = TOTAL;
      $('#quizTotalProgress').value = attempted;
    }
    if ($('#totalPercent')) $('#totalPercent').textContent = `${Math.round((attempted / TOTAL) * 100)}%`;

    if ($('#moduleTip')) {
      if (session.mode === 'daily') $('#moduleTip').textContent = '每日练习：混合 5 个模块，每天 20 题。';
      else if (session.mode === 'mixed') $('#moduleTip').textContent = '综合练习：从全部 5 个模块随机抽题。';
      else if (session.mode === 'wrong') $('#moduleTip').textContent = '错题复习：答对后自动移出错题本。';
      else {
        const m = moduleById.get(session.module);
        $('#moduleTip').textContent = m ? `${m.desc} · 每轮 20 题。` : '每轮 20 题；答错的题会自动加入错题本。';
      }
    }
  }

  function renderResult() {
    if (!resultState) {
      showView('home');
      return;
    }

    const pct = resultState.answered ? Math.round((resultState.correct / resultState.answered) * 100) : 0;
    if ($('#resultPct')) $('#resultPct').textContent = `${pct}%`;
    if ($('#resultRatio')) $('#resultRatio').textContent = `${resultState.correct} / ${resultState.answered}`;
    if ($('#resultCorrect')) $('#resultCorrect').textContent = String(resultState.correct);
    if ($('#resultWrong')) $('#resultWrong').textContent = String(resultState.answered - resultState.correct);
    if ($('#resultTime')) $('#resultTime').textContent = formatDuration(resultState.duration);
    if ($('#resultSub')) $('#resultSub').textContent = `${modeLabel(resultState.mode, resultState.module)} · ${resultState.total} 题`;

    const ring = $('#ringFg');
    if (ring) {
      const circumference = 2 * Math.PI * 52;
      ring.style.strokeDasharray = String(circumference);
      ring.style.strokeDashoffset = String(circumference * (1 - pct / 100));
    }

    const again = $('#againBtn');
    if (again) {
      if (resultState.mode === 'daily') again.textContent = '随机加练 20 题';
      else if (resultState.mode === 'wrong') again.textContent = '再复习一轮';
      else if (resultState.mode === 'mixed') again.textContent = '再随机一组';
      else again.textContent = '再练一组';
    }

    const wrongItems = resultState.ids.map((id) => {
      const q = byId.get(id);
      const selection = resultState.answers[id];
      if (!q || selection == null || selection === q.answer) return null;
      return { q, selection };
    }).filter(Boolean);

    const review = $('#reviewWrongBtn');
    if (review) {
      review.hidden = wrongItems.length === 0;
      review.textContent = `复习本轮错题（${wrongItems.length}）`;
    }

    const list = $('#resultWrongList');
    if (list) {
      if (!wrongItems.length) {
        list.innerHTML = emptyState('本轮没有错题，漂亮。', '继续保持这个状态', checkIcon);
      } else {
        list.innerHTML = `<div class="card-head" style="margin:28px 0 0"><h2>本轮错题（${wrongItems.length}）</h2></div>`
          + wrongItems.map(({ q, selection }) => {
            const orderText = q.module === 'ordering' ? `<span class="feedback-extra">正确顺序：${q.order.join(' → ')}</span>` : '';
            return `<div class="result-wrong-item">
              <div class="result-wrong-main">
                <div class="result-wrong-meta">${escapeHtml(moduleName(q.module))} · ${escapeHtml(q.source)} · 你选了 ${selection + 1}，正确答案 ${q.answer + 1}</div>
                <p class="result-wrong-stem">${escapeHtml(previewStem(q))}</p>
                <p class="result-wrong-answer">${q.answer + 1}. ${escapeHtml(q.options[q.answer])}${orderText}</p>
              </div>
            </div>`;
          }).join('');
      }
    }
  }

  function renderWrongBook() {
    const ids = Object.keys(wrong)
      .filter((id) => byId.has(id))
      .sort((a, b) => (wrong[b] && wrong[b].lastAt ? wrong[b].lastAt : 0) - (wrong[a] && wrong[a].lastAt ? wrong[a].lastAt : 0));

    if ($('#navWrongBadge')) $('#navWrongBadge').textContent = String(ids.length);
    if ($('#wrongSub')) $('#wrongSub').textContent = `共 ${ids.length} 题 · 答对后自动移出`;
    if ($('#wrongPracticeBtn')) $('#wrongPracticeBtn').disabled = ids.length === 0;

    const list = $('#wrongList');
    if (!list) return;
    list.classList.toggle('is-single', ids.length === 1);

    if (!ids.length) {
      list.innerHTML = `<div class="card empty-state" style="grid-column:1/-1">${bookIcon}<p>还没有错题，继续保持。</p><span>答错的题会自动加入这里</span></div>`;
      return;
    }

    list.innerHTML = ids.map((id) => {
      const q = byId.get(id);
      const record = wrong[id] || {};
      const orderText = q.module === 'ordering' ? `<span class="feedback-extra">正确顺序：${q.order.join(' → ')}</span>` : '';
      return `<article class="card wrong-item">
        <div class="wrong-meta">
          <span>${escapeHtml(moduleName(q.module))}</span>
          <span>${escapeHtml(q.source)}</span>
          <span class="badge-danger">错 ${record.count || 1} 次</span>
        </div>
        <p class="wrong-stem">${escapeHtml(previewStem(q))}</p>
        <div class="wrong-answer">正确答案：${q.answer + 1}. ${escapeHtml(q.options[q.answer])}${orderText}</div>
        <div class="wrong-actions">
          <button type="button" class="btn secondary btn-sm" data-action="redo" data-id="${escapeHtml(q.id)}">重做</button>
          <button type="button" class="btn ghost btn-sm" data-action="remove" data-id="${escapeHtml(q.id)}">移除</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderHistory() {
    const attempted = attemptedCount();
    const acc = accuracy();
    const learningDays = Object.keys(progress.days).filter((key) => progress.days[key] && progress.days[key].attempts > 0).length;

    if ($('#histAttempted')) $('#histAttempted').textContent = String(attempted);
    if ($('#histTotal')) $('#histTotal').textContent = String(TOTAL);
    if ($('#histAccuracy')) $('#histAccuracy').textContent = acc == null ? '—' : `${acc}%`;
    if ($('#histAttempts')) $('#histAttempts').textContent = `${progress.totalAttempts} 次作答`;
    if ($('#histDays')) $('#histDays').textContent = String(learningDays);
    if ($('#histWrong')) $('#histWrong').textContent = String(wrongCount());

    const breakdown = $('#moduleBreakdown');
    if (breakdown) {
      breakdown.innerHTML = MODULES.map((m) => {
        const done = moduleDone(m.id);
        const pct = m.count ? Math.round((done / m.count) * 100) : 0;
        return `<div class="module-row">
          <span class="module-row-name">${m.name}</span>
          <span class="module-row-track"><span class="module-row-fill" style="width:${pct}%"></span></span>
          <span class="module-row-value">${done} / ${m.count}</span>
        </div>`;
      }).join('');
    }

    const week = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const key = dateKey(date);
      week.push({
        key,
        count: progress.days[key] && progress.days[key].attempts ? progress.days[key].attempts : 0,
        label: '日一二三四五六'[date.getDay()],
        today: offset === 0,
      });
    }
    const max = Math.max(1, ...week.map((item) => item.count));

    const bars = $('#weekBars');
    if (bars) {
      bars.innerHTML = week.map((item) => {
        const height = item.count ? Math.max(4, Math.round((item.count / max) * 100)) : 3;
        return `<div class="week-bar ${item.today ? 'is-today' : ''}">
          <b>${item.count}</b>
          <div class="bar" style="height:${height}%"></div>
          <small>${item.label}</small>
        </div>`;
      }).join('');
    }

    const recent = $('#historyRecent');
    if (recent) recent.innerHTML = recentHtml(progress.recent, 8);

    const sessions = $('#sessionHistory');
    if (sessions) {
      if (!progress.sessions.length) {
        sessions.innerHTML = emptyState('还没有完成记录。', '完成一组练习后会显示在这里');
      } else {
        sessions.innerHTML = progress.sessions.slice(0, 8).map((item) => {
          const pct = item.answered ? Math.round((item.correct / item.answered) * 100) : 0;
          return `<div class="session-row">
            <span class="session-row-mode">${escapeHtml(modeLabel(item.mode, item.module))}</span>
            <span class="session-row-date">${formatDateTime(item.at)}</span>
            <span class="session-row-score"><strong>${item.correct}</strong> / ${item.answered} · ${pct}%</span>
          </div>`;
        }).join('');
      }
    }
  }

  // ----------------------------------------------------------------
  // events
  // ----------------------------------------------------------------

  $$('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const nav = button.dataset.nav;
      if (nav === 'home') showView('home');
      if (nav === 'daily') startDaily();
      if (nav === 'wrong') showView('wrong');
      if (nav === 'history') showView('history');
    });
  });

  const moduleGrid = $('#moduleGrid');
  if (moduleGrid) {
    moduleGrid.addEventListener('click', (event) => {
      const card = event.target.closest('[data-module]');
      if (card) startModule(card.dataset.module);
    });
  }

  const dailyStartBtn = $('#dailyStartBtn');
  if (dailyStartBtn) dailyStartBtn.addEventListener('click', startDaily);

  const resumeBtn = $('#resumeBtn');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      if (session && !session.finished) showView('quiz');
    });
  }

  const exitBtn = $('#exitBtn');
  if (exitBtn) exitBtn.addEventListener('click', () => showView('home'));

  const optionsEl = $('#options');
  if (optionsEl) {
    optionsEl.addEventListener('click', (event) => {
      const button = event.target.closest('.option');
      if (!button || button.disabled || !session) return;
      const q = currentQuestion();
      if (!q || session.answers[q.id] != null) return;
      pending = Number(button.dataset.index);
      renderQuiz();
    });
  }

  const submitBtn = $('#submitBtn');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      if (!session) return;
      const q = currentQuestion();
      if (!q) return;
      if (session.answers[q.id] != null) {
        nextQuestion();
        return;
      }
      if (pending == null) {
        toast('请先选择一个答案');
        return;
      }
      submitCurrent(pending);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (currentView !== 'quiz' || !session) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.target && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;

    const q = currentQuestion();
    if (!q) return;

    if (event.key >= '1' && event.key <= '4') {
      event.preventDefault();
      if (session.answers[q.id] != null) return;
      pending = Number(event.key) - 1;
      renderQuiz();
      return;
    }

    if (event.key === 'Enter') {
      if (event.target && event.target.closest('button')) return;
      event.preventDefault();
      if (session.answers[q.id] != null) {
        nextQuestion();
      } else if (pending != null) {
        submitCurrent(pending);
      } else {
        toast('请先选择一个答案');
      }
    }
  });

  const wrongList = $('#wrongList');
  if (wrongList) {
    wrongList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      if (!byId.has(id)) return;

      if (button.dataset.action === 'remove') {
        delete wrong[id];
        saveWrong();
        updateGlobalBadges();
        renderWrongBook();
        toast('已移出错题本');
      }

      if (button.dataset.action === 'redo') {
        beginSession('wrong', [id]);
      }
    });
  }

  const wrongPracticeBtn = $('#wrongPracticeBtn');
  if (wrongPracticeBtn) wrongPracticeBtn.addEventListener('click', startWrong);

  const clearWrongBtn = $('#clearWrongBtn');
  if (clearWrongBtn) {
    clearWrongBtn.addEventListener('click', () => {
      if (!wrongCount()) {
        toast('错题本已经是空的');
        return;
      }
      if (!window.confirm('确定清空错题本？此操作不可撤销。')) return;
      wrong = {};
      saveWrong();
      if (session && session.mode === 'wrong') {
        session = null;
        saveSession();
      }
      updateGlobalBadges();
      renderWrongBook();
      toast('错题本已清空');
    });
  }

  const againBtn = $('#againBtn');
  if (againBtn) {
    againBtn.addEventListener('click', () => {
      if (!resultState) return;
      if (resultState.mode === 'daily' || resultState.mode === 'mixed') {
        startMixed();
        return;
      }
      if (resultState.mode === 'wrong') {
        startWrong();
        return;
      }
      startModule(resultState.module);
    });
  }

  const reviewWrongBtn = $('#reviewWrongBtn');
  if (reviewWrongBtn) {
    reviewWrongBtn.addEventListener('click', () => {
      if (!resultState) return;
      const ids = resultState.ids.filter((id) => {
        const q = byId.get(id);
        return q && resultState.answers[id] != null && resultState.answers[id] !== q.answer;
      });
      if (!ids.length) {
        toast('本轮没有错题');
        return;
      }
      beginSession('wrong', ids);
    });
  }

  const resultHomeBtn = $('#resultHomeBtn');
  if (resultHomeBtn) resultHomeBtn.addEventListener('click', () => showView('home'));

  const clearAllBtn = $('#clearAllBtn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      if (!window.confirm('确定清空全部学习记录？包括进度、错题本和完成记录。')) return;
      progress = defaultProgress();
      wrong = {};
      daily = null;
      session = null;
      resultState = null;
      saveProgress();
      saveWrong();
      save(K.daily, null);
      save(K.session, null);
      ensureDaily();
      updateGlobalBadges();
      showView('home');
      toast('学习记录已清空');
    });
  }

  const themeBtn = $('#themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
      save(K.settings, settings);
      document.documentElement.dataset.theme = settings.theme;
    });
  }

  // ----------------------------------------------------------------
  // boot
  // ----------------------------------------------------------------

  document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
  ensureDaily();
  updateGlobalBadges();
  showView('home');
})();
