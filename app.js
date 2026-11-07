(() => {
  'use strict';

  const QUESTIONS = Array.isArray(window.QUESTIONS) ? window.QUESTIONS : [];
  const TOTAL = QUESTIONS.length;
  const byId = new Map(QUESTIONS.map((q) => [q.i, q]));

  const K = {
    progress: 'n1-grammar.progress.v1',
    daily: 'n1-grammar.daily.v1',
    wrong: 'n1-grammar.wrong.v1',
    session: 'n1-grammar.session.v1',
    settings: 'n1-grammar.settings.v1',
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const checkIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>';
  const xIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>';
  const bookIcon = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z"></path></svg>';

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
      /* Storage may be unavailable in private mode. */
    }
  }

  function defaultProgress() {
    return {
      records: {},
      totalAttempts: 0,
      totalCorrect: 0,
      days: {},
      recent: [],
      sessions: [],
    };
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

  let selectedMode = 'random';
  let pending = null;
  let currentView = 'landing';
  let resultState = null;
  let toastTimer = 0;

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, '0');

  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function monthDay(date = new Date()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function formatDateTime(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
    if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function formatDuration(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function formatStem(text) {
    return escapeHtml(text).replace(/（[\s\u3000]*）/g, '<span class="blank">（　）</span>');
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

  function modeLabel(mode) {
    if (mode === 'daily') return '每日 100 题';
    if (mode === 'wrong') return '错题复习';
    return '随机练习';
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

  // ------------------------------------------------------------------
  // daily set
  // ------------------------------------------------------------------

  function makeDailyIds(key) {
    const random = mulberry32(hashString(`n1-grammar-${key}`));
    return shuffle(QUESTIONS.map((q) => q.i), random).slice(0, Math.min(100, QUESTIONS.length));
  }

  function ensureDaily() {
    const today = dateKey();
    if (!daily || daily.date !== today || !Array.isArray(daily.ids) || daily.ids.length !== Math.min(100, TOTAL)) {
      daily = {
        date: today,
        ids: makeDailyIds(today),
        answers: {},
        cursor: 0,
        completedAt: null,
      };
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
      const q = byId.get(Number(id));
      if (q && selection === q.a) correct += 1;
    });
    const done = entries.length;
    return { done, correct, accuracy: done ? Math.round((correct / done) * 100) : null };
  }

  // ------------------------------------------------------------------
  // persistence / sanitising
  // ------------------------------------------------------------------

  function saveProgress() { save(K.progress, progress); }
  function saveWrong() { save(K.wrong, wrong); }
  function saveSession() { save(K.session, session); }

  Object.keys(wrong).forEach((key) => {
    if (!byId.has(Number(key))) delete wrong[key];
  });

  if (daily && Array.isArray(daily.ids)) {
    daily.ids = daily.ids.filter((id) => byId.has(id));
    if (!daily.ids.length) daily = null;
  }

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

  // ------------------------------------------------------------------
  // records
  // ------------------------------------------------------------------

  function recordAnswer(q, selection, mode) {
    const now = Date.now();
    const ok = selection === q.a;
    const rec = progress.records[q.i] || { attempts: 0, correct: 0, wrong: 0 };

    rec.attempts += 1;
    if (ok) rec.correct += 1;
    else rec.wrong += 1;
    rec.lastAt = now;
    progress.records[q.i] = rec;

    progress.totalAttempts += 1;
    if (ok) progress.totalCorrect += 1;

    const key = dateKey();
    const day = progress.days[key] || { attempts: 0, correct: 0 };
    day.attempts += 1;
    if (ok) day.correct += 1;
    progress.days[key] = day;

    progress.recent.unshift({ id: q.i, sel: selection, ok, at: now, mode });
    progress.recent = progress.recent.slice(0, 40);

    if (!ok) {
      wrong[q.i] = {
        count: (wrong[q.i] && wrong[q.i].count ? wrong[q.i].count : 0) + 1,
        lastAt: now,
        sel: selection,
      };
    } else if (mode === 'wrong') {
      delete wrong[q.i];
    }

    saveProgress();
    saveWrong();
    return ok;
  }

  // ------------------------------------------------------------------
  // session lifecycle
  // ------------------------------------------------------------------

  function currentQuestion() {
    if (!session) return null;
    return byId.get(session.ids[session.index]) || null;
  }

  function nextAvailableIndex() {
    if (!session) return 0;
    let index = session.index + 1;
    while (index < session.ids.length && session.answers[session.ids[index]] != null) {
      index += 1;
    }
    return index;
  }

  function startSession(mode) {
    ensureDaily();

    if (mode === 'daily') {
      const stats = dailyStats();
      if (stats.done >= 100) {
        toast('今天的 100 题已经完成，去随机练习加练吧');
        return;
      }
      const ids = daily.ids.slice();
      const answers = { ...daily.answers };
      let index = ids.findIndex((id) => answers[id] == null);
      if (index < 0) index = 0;
      session = {
        mode: 'daily',
        ids,
        index,
        answers,
        startedAt: Date.now(),
        roundSize: ids.length,
        date: daily.date,
        finished: false,
      };
    } else if (mode === 'wrong') {
      const ids = shuffle(Object.keys(wrong).map(Number).filter((id) => byId.has(id))).slice(0, 100);
      if (!ids.length) {
        toast('错题本还是空的');
        return;
      }
      session = {
        mode: 'wrong',
        ids,
        index: 0,
        answers: {},
        startedAt: Date.now(),
        roundSize: ids.length,
        date: null,
        finished: false,
      };
    } else {
      const size = Math.min(Math.max(Number($('#roundSize').value) || 20, 1), TOTAL);
      const ids = shuffle(QUESTIONS.map((q) => q.i)).slice(0, size);
      session = {
        mode: 'random',
        ids,
        index: 0,
        answers: {},
        startedAt: Date.now(),
        roundSize: size,
        date: null,
        finished: false,
      };
    }

    pending = null;
    saveSession();
    showView('quiz');
  }

  function startCustomSession(mode, ids) {
    const validIds = ids.filter((id) => byId.has(id));
    if (!validIds.length) {
      toast('没有可复习的题目');
      return;
    }
    session = {
      mode,
      ids: validIds,
      index: 0,
      answers: {},
      startedAt: Date.now(),
      roundSize: validIds.length,
      date: null,
      finished: false,
    };
    pending = null;
    saveSession();
    showView('quiz');
  }

  function submitCurrent(selection) {
    if (!session) return;
    const q = currentQuestion();
    if (!q || session.answers[q.i] != null) return;

    recordAnswer(q, selection, session.mode);
    session.answers[q.i] = selection;

    if (session.mode === 'daily') {
      const d = ensureDaily();
      d.answers[q.i] = selection;
      d.cursor = Math.min(d.ids.length, session.index + 1);
      if (Object.keys(d.answers).length >= d.ids.length && !d.completedAt) {
        d.completedAt = Date.now();
      }
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
      const q = byId.get(Number(id));
      if (q && session.answers[id] === q.a) correct += 1;
    });

    const duration = Date.now() - session.startedAt;
    session.finished = true;
    saveSession();

    progress.sessions.unshift({
      at: Date.now(),
      mode: session.mode,
      total: session.ids.length,
      answered,
      correct,
      duration,
    });
    progress.sessions = progress.sessions.slice(0, 30);
    saveProgress();

    resultState = {
      mode: session.mode,
      total: session.ids.length,
      answered,
      correct,
      duration,
      roundSize: session.roundSize,
      ids: session.ids.slice(),
      answers: { ...session.answers },
    };

    showView('result');
  }

  // ------------------------------------------------------------------
  // views
  // ------------------------------------------------------------------

  function showView(name) {
    if (name === 'quiz' && (!session || session.finished)) name = 'landing';
    if (name === 'result' && !resultState) name = 'landing';

    currentView = name;
    $$('.view').forEach((view) => {
      view.hidden = true;
    });
    const target = $(`#view-${name}`);
    if (target) target.hidden = false;

    $$('.nav-btn').forEach((button) => {
      const nav = button.dataset.nav;
      const active = (nav === 'home' && name === 'landing')
        || (nav === 'wrong' && name === 'wrong')
        || (nav === 'history' && name === 'history');
      button.classList.toggle('is-active', active);
    });

    if (name === 'landing') renderLanding();
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

  function syncModeCards() {
    $$('.mode-card').forEach((card) => {
      const active = card.dataset.mode === selectedMode;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function updateStartButton() {
    const button = $('#startBtn');
    if (!button) return;

    if (selectedMode === 'wrong') {
      const count = wrongCount();
      const hint = $('#modeWrongHint');
      if (hint) hint.textContent = count ? `${count} 题待复习` : '暂无错题';
      if (!count) {
        button.disabled = true;
        button.textContent = '暂无可复习错题';
        return;
      }
      button.disabled = false;
      button.innerHTML = `复习错题（${count}） <span aria-hidden="true">→</span>`;
      return;
    }

    const hint = $('#modeWrongHint');
    if (hint) hint.textContent = '复习答错的题';

    if (selectedMode === 'daily') {
      const stats = dailyStats();
      if (stats.done >= 100) {
        button.disabled = true;
        button.textContent = '今日已完成';
        return;
      }
      button.disabled = false;
      button.innerHTML = stats.done > 0
        ? `继续今日挑战（还剩 ${100 - stats.done} 题） <span aria-hidden="true">→</span>`
        : '开始今日挑战 <span aria-hidden="true">→</span>';
      return;
    }

    button.disabled = false;
    button.innerHTML = '开始练习 <span aria-hidden="true">→</span>';
  }

  function renderDailyCard() {
    const stats = dailyStats();
    const doneEl = $('#dailyDone');
    const progressEl = $('#dailyProgress');
    const noteEl = $('#dailyNote');
    const button = $('#dailyStartBtn');
    const dateEl = $('#dailyDate');

    if (doneEl) doneEl.textContent = String(stats.done);
    if (progressEl) progressEl.value = stats.done;
    if (dateEl) dateEl.textContent = monthDay();

    if (stats.done >= 100) {
      if (noteEl) noteEl.textContent = `今日已完成 · 正确率 ${stats.accuracy}%`;
      if (button) {
        button.disabled = true;
        button.textContent = '今日已完成';
      }
    } else {
      if (noteEl) {
        noteEl.textContent = stats.done > 0
          ? `已答 ${stats.done} 题 · 正确 ${stats.correct} 题`
          : '每天固定 100 题，刷新不丢进度。';
      }
      if (button) {
        button.disabled = false;
        button.textContent = stats.done > 0
          ? `继续今日挑战（还剩 ${100 - stats.done} 题）`
          : '开始今日挑战';
      }
    }
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
          <strong>#${q.n}</strong>
          <span>${formatStem(q.q)}</span>
        </div>
        <span class="recent-time">${timeAgo(item.at)}</span>
      </div>`;
    }).join('');
  }

  function renderResume() {
    const banner = $('#resumeBanner');
    if (!banner) return;
    const resumable = session && !session.finished && session.ids && session.ids.length;
    banner.hidden = !resumable;
    if (resumable) {
      const text = $('#resumeText');
      if (text) {
        text.textContent = `${modeLabel(session.mode)} · 已答 ${Object.keys(session.answers).length}/${session.ids.length}`;
      }
    }
  }

  function renderLanding() {
    ensureDaily();

    const attempted = attemptedCount();
    const acc = accuracy();
    const wc = wrongCount();

    if ($('#landTotal')) $('#landTotal').textContent = String(TOTAL);
    if ($('#landAttempted')) $('#landAttempted').textContent = String(attempted);
    if ($('#landProgress')) {
      $('#landProgress').max = TOTAL;
      $('#landProgress').value = attempted;
    }
    if ($('#landStatAttempted')) $('#landStatAttempted').textContent = String(attempted);
    if ($('#landStatAccuracy')) $('#landStatAccuracy').textContent = acc == null ? '—' : `${acc}%`;
    if ($('#landStatWrong')) $('#landStatWrong').textContent = String(wc);

    renderDailyCard();
    renderResume();
    syncModeCards();
    updateStartButton();
    updateGlobalBadges();

    const recent = $('#recentList');
    if (recent) recent.innerHTML = recentHtml(progress.recent, 4);

    const roundSize = $('#roundSize');
    if (roundSize) roundSize.disabled = selectedMode !== 'random';
  }

  function renderQuiz() {
    if (!session) {
      showView('landing');
      return;
    }

    const total = session.ids.length;
    if (session.index >= total) {
      finishSession();
      return;
    }

    const q = currentQuestion();
    if (!q) {
      toast('题目数据异常，已返回首页');
      showView('landing');
      return;
    }

    const submitted = session.answers[q.i] != null;
    const selected = submitted ? session.answers[q.i] : pending;
    const answered = Object.keys(session.answers).length;
    const answeredIds = Object.keys(session.answers);
    let correct = 0;
    answeredIds.forEach((id) => {
      const item = byId.get(Number(id));
      if (item && session.answers[id] === item.a) correct += 1;
    });

    if ($('#quizModeChip')) $('#quizModeChip').textContent = modeLabel(session.mode);
    if ($('#quizMeta')) $('#quizMeta').textContent = `原题号 #${q.n} · PDF P${q.p}`;
    if ($('#quizStep')) $('#quizStep').textContent = `第 ${session.index + 1} / ${total} 题`;
    if ($('#quizPercent')) $('#quizPercent').textContent = `${Math.round((answered / total) * 100)}%`;
    if ($('#quizProgress')) {
      $('#quizProgress').max = total;
      $('#quizProgress').value = answered;
    }

    const stem = $('#stem');
    if (stem) stem.innerHTML = formatStem(q.q);

    const options = $('#options');
    if (options) {
      options.innerHTML = q.o.map((text, index) => {
        let className = 'option';
        let mark = '';
        if (submitted) {
          if (index === q.a) {
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
        const ok = selected === q.a;
        let extra = ok ? '' : ' · 已加入错题本';
        if (ok && session.mode === 'wrong') extra = ' · 已移出错题本';
        feedback.hidden = false;
        feedback.className = `feedback ${ok ? 'ok' : 'bad'}`;
        feedback.innerHTML = `<span class="feedback-icon">${ok ? checkIcon : xIcon}</span>
          <div>
            <strong>${ok ? '回答正确' : '回答错误'}</strong>
            <p>${ok ? '答案' : '正确答案'}：${(ok ? selected : q.a) + 1}. ${escapeHtml(q.o[ok ? selected : q.a])}${extra}</p>
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
    if ($('#quizTotalProgress')) {
      $('#quizTotalProgress').max = TOTAL;
      $('#quizTotalProgress').value = attempted;
    }
    if ($('#totalPercent')) $('#totalPercent').textContent = `${Math.round((attempted / TOTAL) * 100)}%`;
  }

  function renderResult() {
    if (!resultState) {
      showView('landing');
      return;
    }

    const pct = resultState.answered ? Math.round((resultState.correct / resultState.answered) * 100) : 0;
    if ($('#resultPct')) $('#resultPct').textContent = `${pct}%`;
    if ($('#resultRatio')) $('#resultRatio').textContent = `${resultState.correct} / ${resultState.answered}`;
    if ($('#resultCorrect')) $('#resultCorrect').textContent = String(resultState.correct);
    if ($('#resultWrong')) $('#resultWrong').textContent = String(resultState.answered - resultState.correct);
    if ($('#resultTime')) $('#resultTime').textContent = formatDuration(resultState.duration);

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
      else again.textContent = '再来一组';
    }

    const wrongItems = resultState.ids.map((id) => {
      const q = byId.get(id);
      const selection = resultState.answers[id];
      if (!q || selection == null || selection === q.a) return null;
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
          + wrongItems.map(({ q, selection }) => `<div class="result-wrong-item">
            <div class="result-wrong-main">
              <div class="result-wrong-meta">#${q.n} · 你选了 ${selection + 1}，正确答案 ${q.a + 1}</div>
              <p class="result-wrong-stem">${formatStem(q.q)}</p>
              <p class="result-wrong-answer">${q.a + 1}. ${escapeHtml(q.o[q.a])}</p>
            </div>
          </div>`).join('');
      }
    }
  }

  function renderWrongBook() {
    const ids = Object.keys(wrong)
      .map(Number)
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
      return `<article class="card wrong-item">
        <div class="wrong-meta">
          <span>#${q.n}</span>
          <span>PDF P${q.p}</span>
          <span class="badge-danger">错 ${record.count || 1} 次</span>
        </div>
        <p class="wrong-stem">${formatStem(q.q)}</p>
        <div class="wrong-answer">正确答案：${q.a + 1}. ${escapeHtml(q.o[q.a])}</div>
        <div class="wrong-actions">
          <button type="button" class="btn secondary btn-sm" data-action="redo" data-id="${q.i}">重做</button>
          <button type="button" class="btn ghost btn-sm" data-action="remove" data-id="${q.i}">移除</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderHistory() {
    const attempted = attemptedCount();
    const acc = accuracy();
    const learningDays = Object.keys(progress.days).filter((key) => progress.days[key] && progress.days[key].attempts > 0).length;

    if ($('#histAttempted')) $('#histAttempted').textContent = String(attempted);
    if ($('#histAccuracy')) $('#histAccuracy').textContent = acc == null ? '—' : `${acc}%`;
    if ($('#histAttempts')) $('#histAttempts').textContent = `${progress.totalAttempts} 次作答`;
    if ($('#histDays')) $('#histDays').textContent = String(learningDays);
    if ($('#histWrong')) $('#histWrong').textContent = String(wrongCount());

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
            <span class="session-row-mode">${modeLabel(item.mode)}</span>
            <span class="session-row-date">${formatDateTime(item.at)}</span>
            <span class="session-row-score"><strong>${item.correct}</strong> / ${item.answered} · ${pct}%</span>
          </div>`;
        }).join('');
      }
    }
  }

  function selectMode(mode) {
    selectedMode = mode;
    syncModeCards();
    updateStartButton();
    const roundSize = $('#roundSize');
    if (roundSize) roundSize.disabled = mode !== 'random';
  }

  // ------------------------------------------------------------------
  // events
  // ------------------------------------------------------------------

  $$('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const nav = button.dataset.nav;
      if (nav === 'home') showView('landing');
      if (nav === 'wrong') showView('wrong');
      if (nav === 'history') showView('history');
    });
  });

  $$('.mode-card').forEach((card) => {
    card.addEventListener('click', () => selectMode(card.dataset.mode));
  });

  const roundSize = $('#roundSize');
  if (roundSize) {
    roundSize.addEventListener('change', () => {
      selectedMode = 'random';
      syncModeCards();
      updateStartButton();
    });
  }

  const startBtn = $('#startBtn');
  if (startBtn) startBtn.addEventListener('click', () => startSession(selectedMode));

  const dailyStartBtn = $('#dailyStartBtn');
  if (dailyStartBtn) {
    dailyStartBtn.addEventListener('click', () => {
      selectedMode = 'daily';
      syncModeCards();
      startSession('daily');
    });
  }

  const resumeBtn = $('#resumeBtn');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      if (session && !session.finished) showView('quiz');
    });
  }

  const exitBtn = $('#exitBtn');
  if (exitBtn) exitBtn.addEventListener('click', () => showView('landing'));

  const optionsEl = $('#options');
  if (optionsEl) {
    optionsEl.addEventListener('click', (event) => {
      const button = event.target.closest('.option');
      if (!button || button.disabled || !session) return;
      const q = currentQuestion();
      if (!q || session.answers[q.i] != null) return;
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
      if (session.answers[q.i] != null) {
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
      if (session.answers[q.i] != null) return;
      pending = Number(event.key) - 1;
      renderQuiz();
      return;
    }

    if (event.key === 'Enter') {
      if (event.target && event.target.closest('button')) return;
      event.preventDefault();
      if (session.answers[q.i] != null) {
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
      const id = Number(button.dataset.id);
      if (!byId.has(id)) return;

      if (button.dataset.action === 'remove') {
        delete wrong[id];
        saveWrong();
        updateGlobalBadges();
        renderWrongBook();
        toast('已移出错题本');
      }

      if (button.dataset.action === 'redo') {
        startCustomSession('wrong', [id]);
      }
    });
  }

  const wrongPracticeBtn = $('#wrongPracticeBtn');
  if (wrongPracticeBtn) wrongPracticeBtn.addEventListener('click', () => startSession('wrong'));

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
      if (resultState.mode === 'daily') {
        selectedMode = 'random';
        syncModeCards();
        const sizeSelect = $('#roundSize');
        if (sizeSelect) sizeSelect.value = '20';
        startSession('random');
        return;
      }
      startSession(resultState.mode);
    });
  }

  const reviewWrongBtn = $('#reviewWrongBtn');
  if (reviewWrongBtn) {
    reviewWrongBtn.addEventListener('click', () => {
      if (!resultState) return;
      const ids = resultState.ids.filter((id) => {
        const q = byId.get(id);
        return q && resultState.answers[id] != null && resultState.answers[id] !== q.a;
      });
      startCustomSession('wrong', ids);
    });
  }

  const resultHomeBtn = $('#resultHomeBtn');
  if (resultHomeBtn) resultHomeBtn.addEventListener('click', () => showView('landing'));

  const clearAllBtn = $('#clearAllBtn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      if (!window.confirm('确定清空全部学习记录？包括进度、错题本和完成记录。')) return;
      progress = defaultProgress();
      wrong = {};
      daily = null;
      session = null;
      resultState = null;
      selectedMode = 'random';
      saveProgress();
      saveWrong();
      save(K.daily, null);
      save(K.session, null);
      ensureDaily();
      updateGlobalBadges();
      showView('landing');
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

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------

  document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';

  if (!TOTAL) {
    const main = $('.main');
    if (main) {
      main.innerHTML = '<div class="card"><h1 class="card-title">题库加载失败</h1><p class="hint">请确认 data.js 与 index.html 位于同一目录。</p></div>';
    }
    return;
  }

  ensureDaily();
  showView('landing');
})();
