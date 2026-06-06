/* MathBOT - Complete Application Logic */
(function () {
  'use strict';

  const CONFIG = {
    APP_NAME: 'MathBOT',
    CORRECT_REWARD: 0.02,
    REFERRAL_REWARD: 30.0,
    MIN_WITHDRAWAL: 100,
    ACTIVATION_VALUE: 159,
    ANTI_SPAM_MS: 1000,
    DB_PREFIX: 'mathbot_db_',
    SESSION_KEY: 'mathbot_session',
    THEME_KEY: 'mathbot_theme',
    NOTIFY_KEY: 'mathbot_notifications'
  };

  const DB_FILES = [
    'users', 'referrals', 'withdrawals', 'activation_codes',
    'earnings', 'questions_history', 'admin_logs'
  ];

  const DB_DEFAULTS = {
    users: { users: [] },
    referrals: { referrals: [] },
    withdrawals: { withdrawals: [] },
    activation_codes: {
      codes: [
        { id: 'MB-DEMO-CODE-0001', generatedDate: '2026-01-01T00:00:00.000Z', status: 'unused', userAssigned: null, value: 159 },
        { id: 'MB-DEMO-CODE-0002', generatedDate: '2026-01-01T00:00:00.000Z', status: 'unused', userAssigned: null, value: 159 },
        { id: 'MB-DEMO-CODE-0003', generatedDate: '2026-01-01T00:00:00.000Z', status: 'unused', userAssigned: null, value: 159 }
      ]
    },
    earnings: { earnings: [] },
    questions_history: { globalSeen: [], userQuestions: {} },
    admin_logs: { logs: [] }
  };

  let dbCache = {};
  let dbReady = false;
  let lastSubmitTime = 0;

  /* ========== UTILITIES ========== */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function formatPHP(amount) {
    return '₱' + Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function showToast(message, type = 'info') {
    let container = $('#toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function showLoader(show = true) {
    let loader = $('#app-loader');
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'app-loader';
      loader.innerHTML = '<div class="loader-spinner"></div><p>Loading MathBOT...</p>';
      document.body.appendChild(loader);
    }
    loader.classList.toggle('hidden', !show);
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function downloadCSV(filename, rows) {
    if (!rows.length) return showToast('No data to export', 'warning');
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Report exported', 'success');
  }

  /* ========== THEME ========== */
  function initTheme() {
    const saved = localStorage.getItem(CONFIG.THEME_KEY) || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    $$('[data-theme-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem(CONFIG.THEME_KEY, next);
      });
    });
  }

  /* ========== CRYPTO / SECURITY ========== */
  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(salt + password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function generateSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function validatePhone(phone) {
    return /^09\d{9}$/.test(phone.replace(/\s/g, ''));
  }

  function validateUsername(username) {
    return /^[a-zA-Z0-9_]{3,20}$/.test(username);
  }

  /* ========== DATABASE ========== */
  function saveDB(name) {
    localStorage.setItem(CONFIG.DB_PREFIX + name, JSON.stringify(dbCache[name]));
  }

  function getTable(name) {
    return dbCache[name] || DB_DEFAULTS[name];
  }

  async function loadDBFromFiles() {
    for (const name of DB_FILES) {
      const stored = localStorage.getItem(CONFIG.DB_PREFIX + name);
      if (stored) {
        try { dbCache[name] = JSON.parse(stored); } catch { dbCache[name] = structuredClone(DB_DEFAULTS[name]); }
        continue;
      }
      try {
        const res = await fetch(`database/${name}.json`);
        if (res.ok) {
          dbCache[name] = await res.json();
        } else {
          dbCache[name] = structuredClone(DB_DEFAULTS[name]);
        }
      } catch {
        dbCache[name] = structuredClone(DB_DEFAULTS[name]);
      }
      saveDB(name);
    }
    await ensureDefaultAdmin();
    dbReady = true;
  }

  async function ensureDefaultAdmin() {
    const users = getTable('users').users;
    let admin = users.find(u => u.username === 'admin');
    if (!admin) {
      const salt = 'mathbot_admin_salt';
      const hash = await hashPassword('admin123', salt);
      admin = {
        id: 'admin-001', name: 'System Administrator', username: 'admin',
        phone: '09000000000', passwordHash: hash, salt, role: 'admin', status: 'active',
        earnings: 0, referralEarnings: 0, totalWithdrawn: 0, referralCount: 0,
        stats: { totalAnswered: 0, correct: 0, wrong: 0 },
        registrationDate: new Date().toISOString(), activationCode: 'ADMIN', referredBy: null
      };
      users.push(admin);
    } else if (!admin.passwordHash || admin.passwordHash.length < 32) {
      admin.salt = admin.salt || 'mathbot_admin_salt';
      admin.passwordHash = await hashPassword('admin123', admin.salt);
    }
    saveDB('users');
  }

  function logAdmin(action, details) {
    const logs = getTable('admin_logs').logs;
    logs.unshift({ id: uid(), action, details, date: new Date().toISOString(), admin: getSession()?.username || 'system' });
    if (logs.length > 500) logs.length = 500;
    saveDB('admin_logs');
  }

  function addNotification(userId, message, type = 'info') {
    const key = CONFIG.NOTIFY_KEY;
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    if (!all[userId]) all[userId] = [];
    all[userId].unshift({ id: uid(), message, type, date: new Date().toISOString(), read: false });
    if (all[userId].length > 50) all[userId].length = 50;
    localStorage.setItem(key, JSON.stringify(all));
  }

  function getNotifications(userId) {
    const all = JSON.parse(localStorage.getItem(CONFIG.NOTIFY_KEY) || '{}');
    return all[userId] || [];
  }

  function markNotificationsRead(userId) {
    const all = JSON.parse(localStorage.getItem(CONFIG.NOTIFY_KEY) || '{}');
    if (all[userId]) all[userId].forEach(n => n.read = true);
    localStorage.setItem(CONFIG.NOTIFY_KEY, JSON.stringify(all));
  }

  /* ========== SESSION ========== */
  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(CONFIG.SESSION_KEY)); } catch { return null; }
  }

  function setSession(user) {
    sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify({
      id: user.id, username: user.username, role: user.role, name: user.name
    }));
  }

  function clearSession() {
    sessionStorage.removeItem(CONFIG.SESSION_KEY);
  }

  function requireAuth(role = null) {
    const session = getSession();
    if (!session) { window.location.href = 'login.html'; return null; }
    if (role && session.role !== role) {
      window.location.href = session.role === 'admin' ? 'admin.html' : 'dashboard.html';
      return null;
    }
    const user = getTable('users').users.find(u => u.id === session.id);
    if (!user || user.status === 'banned') {
      clearSession();
      showToast('Account suspended', 'error');
      window.location.href = 'login.html';
      return null;
    }
    return { session, user };
  }

  function getCurrentUser() {
    const session = getSession();
    if (!session) return null;
    return getTable('users').users.find(u => u.id === session.id) || null;
  }

  /* ========== ACTIVATION CODES ========== */
  function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `MB-${seg()}-${seg()}-${seg()}`;
  }

  /* ========== MATH GAME ========== */
  const OPS = [
    { sym: '+', fn: (a, b) => a + b },
    { sym: '-', fn: (a, b) => a - b },
    { sym: '×', fn: (a, b) => a * b },
    { sym: '÷', fn: (a, b) => a / b }
  ];

  function randDigits(minD, maxD) {
    const len = minD + Math.floor(Math.random() * (maxD - minD + 1));
    let n = Math.floor(Math.random() * 9) + 1;
    for (let i = 1; i < len; i++) n = n * 10 + Math.floor(Math.random() * 10);
    return n;
  }

  function generateQuestion(userId) {
    const hist = getTable('questions_history');
    const userSeen = new Set([...(hist.globalSeen || []), ...((hist.userQuestions || {})[userId] || [])]);
    let attempts = 0;
    while (attempts < 200) {
      attempts++;
      const opIdx = Math.floor(Math.random() * OPS.length);
      const op = OPS[opIdx];
      let a, b, answer;

      if (op.sym === '÷') {
        b = randDigits(2, 3);
        answer = randDigits(2, 4);
        a = b * answer;
        if (String(a).length < 4 || String(a).length > 6) continue;
      } else if (op.sym === '×') {
        a = randDigits(4, 6);
        b = randDigits(2, 3);
        answer = a * b;
      } else if (op.sym === '-') {
        a = randDigits(4, 6);
        b = randDigits(4, 6);
        if (b > a) [a, b] = [b, a];
        answer = a - b;
      } else {
        a = randDigits(4, 6);
        b = randDigits(4, 6);
        answer = a + b;
      }

      const key = `${a}${op.sym}${b}`;
      if (userSeen.has(key)) continue;

      userSeen.add(key);
      if (!hist.userQuestions) hist.userQuestions = {};
      if (!hist.userQuestions[userId]) hist.userQuestions[userId] = [];
      hist.userQuestions[userId].push(key);
      if (!hist.globalSeen) hist.globalSeen = [];
      hist.globalSeen.push(key);
      saveDB('questions_history');

      return { a, b, op: op.sym, answer, key, display: `${a.toLocaleString()} ${op.sym} ${b.toLocaleString()} = ?` };
    }
    return { a: 1234, b: 5678, op: '+', answer: 6912, key: 'fallback', display: '1234 + 5678 = ?' };
  }

  /* ========== EARNINGS & ACTIVITY ========== */
  function recordEarning(userId, username, amount, type, description) {
    const earnings = getTable('earnings').earnings;
    earnings.unshift({
      id: uid(), userId, username, amount, type, description,
      date: new Date().toISOString()
    });
    saveDB('earnings');
  }

  function getRecentActivity(limit = 10) {
    const earnings = getTable('earnings').earnings.slice(0, limit);
    return earnings.map(e => ({
      text: `${e.username} earned ${formatPHP(e.amount)} — ${e.description}`,
      date: e.date, type: e.type
    }));
  }

  function getDailyLeaderboard() {
    const today = todayKey();
    const map = {};
    getTable('earnings').earnings.forEach(e => {
      if (e.date.slice(0, 10) !== today) return;
      map[e.username] = (map[e.username] || 0) + e.amount;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }

  function getTopEarners() {
    return getTable('users').users
      .filter(u => u.role !== 'admin')
      .map(u => ({ username: u.username, total: u.earnings + u.referralEarnings }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }

  /* ========== AUTH: REGISTER ========== */
  async function handleRegister(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    const username = form.username.value.trim().toLowerCase();
    const phone = form.phone.value.trim().replace(/\s/g, '');
    const activationCode = form.activationCode.value.trim().toUpperCase();
    const referralUsername = form.referralUsername.value.trim().toLowerCase();

    if (!name || name.length < 2) return showToast('Enter your complete name', 'error');
    if (!validateUsername(username)) return showToast('Username: 3-20 chars, letters/numbers/_', 'error');
    if (!validatePhone(phone)) return showToast('Phone must be 11 digits starting with 09', 'error');
    if (!activationCode) return showToast('Activation code is required', 'error');

    const users = getTable('users').users;
    if (users.some(u => u.username === username)) return showToast('Username already taken', 'error');
    if (users.some(u => u.phone === phone)) return showToast('Phone number already registered', 'error');

    const codes = getTable('activation_codes').codes;
    const code = codes.find(c => c.id === activationCode);
    if (!code) return showToast('Invalid activation code', 'error');
    if (code.status === 'disabled') return showToast('Activation code is disabled', 'error');
    if (code.status === 'used') return showToast('Activation code already used', 'error');

    let referrer = null;
    if (referralUsername) {
      referrer = users.find(u => u.username === referralUsername && u.role !== 'admin');
      if (!referrer) return showToast('Referral username not found', 'error');
      if (referrer.username === username) return showToast('Cannot refer yourself', 'error');
    }

    const password = form.password?.value || phone.slice(-6);
    const salt = generateSalt();
    const passwordHash = await hashPassword(password, salt);

    const newUser = {
      id: uid(), name, username, phone, passwordHash, salt,
      role: 'user', status: 'active', earnings: 0, referralEarnings: 0,
      totalWithdrawn: 0, referralCount: 0,
      stats: { totalAnswered: 0, correct: 0, wrong: 0 },
      registrationDate: new Date().toISOString(),
      activationCode: activationCode, referredBy: referrer ? referrer.username : null
    };

    users.push(newUser);
    code.status = 'used';
    code.userAssigned = username;
    saveDB('users');
    saveDB('activation_codes');

    if (referrer) {
      const refs = getTable('referrals').referrals;
      const already = refs.some(r => r.referredUsername === username);
      if (!already) {
        referrer.referralEarnings += CONFIG.REFERRAL_REWARD;
        referrer.referralCount += 1;
        referrer.earnings += CONFIG.REFERRAL_REWARD;
        refs.push({
          id: uid(), referrerUsername: referrer.username, referredUsername: username,
          reward: CONFIG.REFERRAL_REWARD, date: new Date().toISOString(), rewarded: true
        });
        recordEarning(referrer.id, referrer.username, CONFIG.REFERRAL_REWARD, 'referral',
          `Referral bonus for ${username}`);
        addNotification(referrer.id, `You earned ${formatPHP(CONFIG.REFERRAL_REWARD)} from referral ${username}!`, 'success');
        saveDB('users');
        saveDB('referrals');
      }
    }

    logAdmin('USER_REGISTERED', `New user: ${username}`);
    addNotification(newUser.id, 'Welcome to MathBOT! Start solving math to earn.', 'success');
    showToast('Registration successful! Login with your username.', 'success');
    setTimeout(() => window.location.href = 'login.html', 1500);
  }

  /* ========== AUTH: LOGIN ========== */
  async function handleLogin(e) {
    e.preventDefault();
    const username = e.target.username.value.trim().toLowerCase();
    const password = e.target.password.value;
    const user = getTable('users').users.find(u => u.username === username);
    if (!user) return showToast('Invalid credentials', 'error');
    if (user.status === 'banned') return showToast('Account has been banned', 'error');
    const hash = await hashPassword(password, user.salt);
    if (hash !== user.passwordHash) return showToast('Invalid credentials', 'error');
    setSession(user);
    showToast(`Welcome back, ${user.name}!`, 'success');
    setTimeout(() => {
      window.location.href = user.role === 'admin' ? 'admin.html' : 'dashboard.html';
    }, 600);
  }

  function handleLogout() {
    clearSession();
    showToast('Logged out securely', 'info');
    setTimeout(() => window.location.href = 'index.html', 400);
  }

  /* ========== DASHBOARD ========== */
  function renderDashboard() {
    const auth = requireAuth('user');
    if (!auth) return;
    const { user } = auth;
    const accuracy = user.stats.totalAnswered
      ? ((user.stats.correct / user.stats.totalAnswered) * 100).toFixed(1) : '0.0';

    const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    set('#user-greeting', `Hello, ${user.name}`);
    set('#total-earnings', formatPHP(user.earnings + user.referralEarnings));
    set('#referral-count', String(user.referralCount));
    set('#referral-earnings', formatPHP(user.referralEarnings));
    set('#total-withdrawn', formatPHP(user.totalWithdrawn));
    set('#stat-answered', String(user.stats.totalAnswered));
    set('#stat-correct', String(user.stats.correct));
    set('#stat-wrong', String(user.stats.wrong));
    set('#stat-accuracy', accuracy + '%');
    set('#referral-username', user.username);

    renderActivityFeed('#activity-feed', 8);
    renderLeaderboard('#daily-leaderboard', getDailyLeaderboard(), 'daily');
    renderLeaderboard('#top-earners', getTopEarners().map(e => [e.username, e.total]), 'earners');
    renderNotifications(user.id);
  }

  function renderNotifications(userId) {
    const list = $('#notification-list');
    const badge = $('#notify-badge');
    if (!list) return;
    const notes = getNotifications(userId);
    const unread = notes.filter(n => !n.read).length;
    if (badge) {
      badge.textContent = unread;
      badge.classList.toggle('hidden', unread === 0);
    }
    if (!notes.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">🔔</div><p>No notifications yet</p></div>';
      return;
    }
    list.innerHTML = notes.slice(0, 10).map(n => `
      <div class="notification-item ${n.read ? '' : 'unread'}">
        <span class="notify-dot"></span>
        <div><p>${escapeHtml(n.message)}</p><small>${formatDate(n.date)}</small></div>
      </div>`).join('');
    markNotificationsRead(userId);
  }

  function renderActivityFeed(selector, limit) {
    const el = $(selector);
    if (!el) return;
    const items = getRecentActivity(limit);
    if (!items.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>No recent activity</p></div>';
      return;
    }
    el.innerHTML = items.map(i => `
      <div class="activity-item fade-in">
        <span class="activity-dot activity-${i.type}"></span>
        <div><p>${escapeHtml(i.text)}</p><small>${formatDate(i.date)}</small></div>
      </div>`).join('');
  }

  function renderLeaderboard(selector, data, type) {
    const el = $(selector);
    if (!el) return;
    if (!data.length) {
      el.innerHTML = '<div class="empty-state small"><p>No data yet</p></div>';
      return;
    }
    el.innerHTML = data.map((item, i) => {
      const name = item[0] || item.username;
      const val = formatPHP(item[1] !== undefined ? item[1] : item.total);
      return `<div class="leaderboard-row rank-${i + 1}"><span class="rank">#${i + 1}</span><span class="name">${escapeHtml(name)}</span><span class="score">${val}</span></div>`;
    }).join('');
  }

  /* ========== GAME ========== */
  let currentQuestion = null;

  function initGame() {
    const auth = requireAuth('user');
    if (!auth) return;
    const { user } = auth;
    loadNextQuestion(user);
    updateGameBalance(user);

    const form = $('#game-form');
    if (form) {
      form.addEventListener('submit', e => { e.preventDefault(); submitAnswer(user); });
    }
    const skipBtn = $('#skip-btn');
    if (skipBtn) skipBtn.addEventListener('click', () => {
      showToast('Question skipped', 'warning');
      loadNextQuestion(user);
    });
  }

  function loadNextQuestion(user) {
    currentQuestion = generateQuestion(user.id);
    const qEl = $('#current-question');
    const input = $('#answer-input');
    if (qEl) qEl.textContent = currentQuestion.display;
    if (input) { input.value = ''; input.focus(); }
    const feedback = $('#game-feedback');
    if (feedback) { feedback.textContent = ''; feedback.className = 'game-feedback'; }
  }

  function updateGameBalance(user) {
    const el = $('#game-balance');
    if (el) el.textContent = formatPHP(user.earnings + user.referralEarnings);
  }

  function submitAnswer(user) {
    const now = Date.now();
    if (now - lastSubmitTime < CONFIG.ANTI_SPAM_MS) {
      return showToast('Please wait before submitting again', 'warning');
    }
    lastSubmitTime = now;

    const input = $('#answer-input');
    const feedback = $('#game-feedback');
    if (!input || !currentQuestion) return;

    const userAnswer = parseFloat(input.value.trim().replace(/,/g, ''));
    if (isNaN(userAnswer)) return showToast('Enter a valid number', 'error');

    const freshUser = getTable('users').users.find(u => u.id === user.id);
    freshUser.stats.totalAnswered += 1;

    const correct = Math.abs(userAnswer - currentQuestion.answer) < 0.001;
    if (correct) {
      freshUser.stats.correct += 1;
      freshUser.earnings += CONFIG.CORRECT_REWARD;
      recordEarning(freshUser.id, freshUser.username, CONFIG.CORRECT_REWARD, 'game', 'Correct answer');
      if (feedback) {
        feedback.textContent = `Correct! +${formatPHP(CONFIG.CORRECT_REWARD)}`;
        feedback.className = 'game-feedback success';
      }
      showToast(`+${formatPHP(CONFIG.CORRECT_REWARD)}`, 'success');
    } else {
      freshUser.stats.wrong += 1;
      if (feedback) {
        feedback.textContent = `Wrong. Answer was ${currentQuestion.answer.toLocaleString()}`;
        feedback.className = 'game-feedback error';
      }
    }
    saveDB('users');
    updateGameBalance(freshUser);
    setTimeout(() => loadNextQuestion(freshUser), correct ? 600 : 1200);
  }

  /* ========== WITHDRAWAL ========== */
  function initWithdrawal() {
    const auth = requireAuth('user');
    if (!auth) return;
    const { user } = auth;
    const balance = user.earnings + user.referralEarnings - getPendingAmount(user.id);
    const balEl = $('#available-balance');
    if (balEl) balEl.textContent = formatPHP(Math.max(0, balance));

    renderWithdrawalHistory(user.id);

    const form = $('#withdrawal-form');
    if (form) form.addEventListener('submit', e => handleWithdrawal(e, user));
  }

  function getPendingAmount(userId) {
    return getTable('withdrawals').withdrawals
      .filter(w => w.userId === userId && w.status === 'pending')
      .reduce((s, w) => s + w.amount, 0);
  }

  function handleWithdrawal(e, user) {
    e.preventDefault();
    const form = e.target;
    const amount = parseFloat(form.amount.value);
    const gcashNumber = form.gcashNumber.value.trim();
    const gcashName = form.gcashName.value.trim();

    if (!gcashName || gcashName.length < 2) return showToast('Enter GCash name', 'error');
    if (!/^09\d{9}$/.test(gcashNumber)) return showToast('Invalid GCash number', 'error');
    if (isNaN(amount) || amount < CONFIG.MIN_WITHDRAWAL) {
      return showToast(`Minimum withdrawal is ${formatPHP(CONFIG.MIN_WITHDRAWAL)}`, 'error');
    }

    const fresh = getTable('users').users.find(u => u.id === user.id);
    const available = fresh.earnings + fresh.referralEarnings - fresh.totalWithdrawn - getPendingAmount(user.id);
    if (amount > available) return showToast('Insufficient balance', 'error');

    const withdrawals = getTable('withdrawals').withdrawals;
    withdrawals.unshift({
      id: uid(), userId: user.id, username: user.username, amount,
      gcashNumber, gcashName, dateRequested: new Date().toISOString(),
      status: 'pending', processedDate: null
    });
    saveDB('withdrawals');
    addNotification(user.id, `Withdrawal of ${formatPHP(amount)} submitted — pending review`, 'info');
    logAdmin('WITHDRAWAL_REQUEST', `${user.username} requested ${formatPHP(amount)}`);
    showToast('Withdrawal request submitted', 'success');
    form.reset();
    initWithdrawal();
  }

  function renderWithdrawalHistory(userId) {
    const el = $('#withdrawal-history');
    if (!el) return;
    const items = getTable('withdrawals').withdrawals.filter(w => w.userId === userId);
    if (!items.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">💸</div><p>No withdrawals yet</p></div>';
      return;
    }
    el.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr>
      <th>Amount</th><th>GCash</th><th>Date</th><th>Status</th></tr></thead><tbody>
      ${items.map(w => `<tr><td>${formatPHP(w.amount)}</td><td>${escapeHtml(w.gcashName)}<br><small>${escapeHtml(w.gcashNumber)}</small></td>
      <td>${formatDate(w.dateRequested)}</td><td><span class="badge badge-${w.status}">${w.status}</span></td></tr>`).join('')}
      </tbody></table></div>`;
  }

  /* ========== ADMIN ========== */
  function initAdmin() {
    const auth = requireAuth('admin');
    if (!auth) return;
    renderAdminStats();
    renderAdminCharts();
    bindAdminTabs();
    renderAdminCodes();
    renderAdminUsers();
    renderAdminWithdrawals();
    renderActivityFeed('#admin-activity', 12);
    bindAdminActions();
  }

  function renderAdminStats() {
    const users = getTable('users').users.filter(u => u.role !== 'admin');
    const activated = users.filter(u => u.activationCode && u.activationCode !== 'PENDING');
    const earnings = getTable('earnings').earnings;
    const refs = getTable('referrals').referrals;
    const wds = getTable('withdrawals').withdrawals;
    const codes = getTable('activation_codes').codes;
    const today = todayKey();

    const totalPaid = earnings.reduce((s, e) => s + e.amount, 0);
    const refRewards = refs.reduce((s, r) => s + r.reward, 0);
    const dailyUsers = users.filter(u => u.registrationDate?.slice(0, 10) === today).length;
    const dailyEarnings = earnings.filter(e => e.date.slice(0, 10) === today).reduce((s, e) => s + e.amount, 0);

    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('#stat-total-users', users.length);
    set('#stat-activated', activated.length);
    set('#stat-earnings-paid', formatPHP(totalPaid));
    set('#stat-ref-rewards', formatPHP(refRewards));
    set('#stat-pending-wd', wds.filter(w => w.status === 'pending').length);
    set('#stat-approved-wd', wds.filter(w => w.status === 'approved').length);
    set('#stat-rejected-wd', wds.filter(w => w.status === 'rejected').length);
    set('#stat-codes', codes.length);
    set('#stat-daily-users', dailyUsers);
    set('#stat-daily-earnings', formatPHP(dailyEarnings));
  }

  function renderAdminCharts() {
    drawBarChart('#chart-users', getLast7DaysUsers(), 'New Users');
    drawBarChart('#chart-earnings', getLast7DaysEarnings(), 'Earnings (₱)');
  }

  function getLast7DaysUsers() {
    const users = getTable('users').users.filter(u => u.role !== 'admin');
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ label: d.toLocaleDateString('en-PH', { weekday: 'short' }), value: users.filter(u => u.registrationDate?.slice(0, 10) === key).length });
    }
    return days;
  }

  function getLast7DaysEarnings() {
    const earnings = getTable('earnings').earnings;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ label: d.toLocaleDateString('en-PH', { weekday: 'short' }), value: earnings.filter(e => e.date.slice(0, 10) === key).reduce((s, e) => s + e.amount, 0) });
    }
    return days;
  }

  function drawBarChart(selector, data, title) {
    const canvas = $(selector);
    if (!canvas || !data.length) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = 280;
    ctx.scale(2, 1);
    const cw = w / 2;
    const max = Math.max(...data.map(d => d.value), 1);
    const barW = (cw - 60) / data.length - 8;
    const colors = getComputedStyle(document.documentElement);
    const primary = colors.getPropertyValue('--primary').trim() || '#2563eb';
    const muted = colors.getPropertyValue('--text-muted').trim() || '#94a3b8';

    ctx.clearRect(0, 0, cw, h);
    ctx.fillStyle = muted;
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(title, 10, 16);

    data.forEach((d, i) => {
      const barH = (d.value / max) * (h - 60);
      const x = 30 + i * (barW + 8);
      const y = h - 30 - barH;
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 4);
      ctx.fill();
      ctx.fillStyle = muted;
      ctx.textAlign = 'center';
      ctx.fillText(d.label, x + barW / 2, h - 10);
      if (d.value > 0) {
        ctx.fillText(d.value < 1 ? d.value.toFixed(2) : String(Math.round(d.value)), x + barW / 2, y - 6);
      }
    });
  }

  function bindAdminTabs() {
    $$('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.admin-tab').forEach(t => t.classList.remove('active'));
        $$('.admin-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = $(`#panel-${tab.dataset.panel}`);
        if (panel) panel.classList.add('active');
      });
    });
  }

  function renderAdminCodes(filter = 'all') {
    const el = $('#codes-table-body');
    if (!el) return;
    let codes = getTable('activation_codes').codes;
    if (filter === 'used') codes = codes.filter(c => c.status === 'used');
    if (filter === 'unused') codes = codes.filter(c => c.status === 'unused');
    if (!codes.length) {
      el.innerHTML = '<tr><td colspan="5"><div class="empty-state small"><p>No codes found</p></div></td></tr>';
      return;
    }
    el.innerHTML = codes.map(c => `<tr>
      <td><code>${escapeHtml(c.id)}</code></td>
      <td>${formatDate(c.generatedDate)}</td>
      <td><span class="badge badge-${c.status}">${c.status}</span></td>
      <td>${c.userAssigned ? escapeHtml(c.userAssigned) : '—'}</td>
      <td class="actions">
        ${c.status === 'unused' ? `<button class="btn btn-sm btn-danger" data-disable-code="${escapeHtml(c.id)}">Disable</button>` : ''}
        <button class="btn btn-sm btn-outline" data-delete-code="${escapeHtml(c.id)}">Delete</button>
      </td></tr>`).join('');
  }

  function renderAdminUsers(search = '') {
    const el = $('#users-table-body');
    if (!el) return;
    let users = getTable('users').users.filter(u => u.role !== 'admin');
    if (search) {
      const q = search.toLowerCase();
      users = users.filter(u => u.name.toLowerCase().includes(q) || u.username.includes(q) || u.phone.includes(q));
    }
    if (!users.length) {
      el.innerHTML = '<tr><td colspan="8"><div class="empty-state small"><p>No users found</p></div></td></tr>';
      return;
    }
    el.innerHTML = users.map(u => `<tr>
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.phone)}</td>
      <td>${formatPHP(u.earnings + u.referralEarnings)}</td>
      <td>${u.referralCount}</td>
      <td>${formatDate(u.registrationDate)}</td>
      <td><span class="badge badge-${u.status}">${u.status}</span></td>
      <td class="actions">
        <button class="btn btn-sm btn-outline" data-edit-user="${u.id}">Edit</button>
        <button class="btn btn-sm ${u.status === 'banned' ? 'btn-success' : 'btn-warning'}" data-ban-user="${u.id}">${u.status === 'banned' ? 'Unban' : 'Ban'}</button>
        <button class="btn btn-sm btn-danger" data-delete-user="${u.id}">Delete</button>
      </td></tr>`).join('');
  }

  function renderAdminWithdrawals() {
    const el = $('#admin-withdrawals-body');
    if (!el) return;
    const wds = getTable('withdrawals').withdrawals;
    if (!wds.length) {
      el.innerHTML = '<tr><td colspan="7"><div class="empty-state small"><p>No withdrawal requests</p></div></td></tr>';
      return;
    }
    el.innerHTML = wds.map(w => `<tr>
      <td>${escapeHtml(w.username)}</td>
      <td>${formatPHP(w.amount)}</td>
      <td>${escapeHtml(w.gcashName)}</td>
      <td>${escapeHtml(w.gcashNumber)}</td>
      <td>${formatDate(w.dateRequested)}</td>
      <td><span class="badge badge-${w.status}">${w.status}</span></td>
      <td class="actions">
        ${w.status === 'pending' ? `
          <button class="btn btn-sm btn-success" data-approve-wd="${w.id}">Approve</button>
          <button class="btn btn-sm btn-danger" data-reject-wd="${w.id}">Reject</button>` : '—'}
      </td></tr>`).join('');
  }

  function bindAdminActions() {
    const genBtn = $('#generate-code-btn');
    if (genBtn) genBtn.addEventListener('click', () => {
      const codes = getTable('activation_codes').codes;
      codes.unshift({ id: generateCode(), generatedDate: new Date().toISOString(), status: 'unused', userAssigned: null, value: CONFIG.ACTIVATION_VALUE });
      saveDB('activation_codes');
      logAdmin('CODE_GENERATED', 'Single code');
      showToast('Code generated', 'success');
      renderAdminCodes(); renderAdminStats();
    });

    const genMulti = $('#generate-multi-btn');
    if (genMulti) genMulti.addEventListener('click', () => {
      const count = parseInt($('#code-count')?.value || '5', 10);
      const codes = getTable('activation_codes').codes;
      for (let i = 0; i < Math.min(count, 50); i++) {
        codes.unshift({ id: generateCode(), generatedDate: new Date().toISOString(), status: 'unused', userAssigned: null, value: CONFIG.ACTIVATION_VALUE });
      }
      saveDB('activation_codes');
      logAdmin('CODES_BULK', `Generated ${count} codes`);
      showToast(`${Math.min(count, 50)} codes generated`, 'success');
      renderAdminCodes(); renderAdminStats();
    });

    $$('[data-code-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('[data-code-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderAdminCodes(btn.dataset.codeFilter);
      });
    });

    const userSearch = $('#user-search');
    if (userSearch) userSearch.addEventListener('input', () => renderAdminUsers(userSearch.value));

    document.body.addEventListener('click', e => {
      const t = e.target.closest('[data-disable-code]');
      if (t) {
        const code = getTable('activation_codes').codes.find(c => c.id === t.dataset.disableCode);
        if (code && code.status === 'unused') { code.status = 'disabled'; saveDB('activation_codes'); renderAdminCodes(); showToast('Code disabled', 'info'); }
      }
      const del = e.target.closest('[data-delete-code]');
      if (del) {
        if (!confirm('Delete this code?')) return;
        const codes = getTable('activation_codes').codes;
        const idx = codes.findIndex(c => c.id === del.dataset.deleteCode);
        if (idx >= 0) { codes.splice(idx, 1); saveDB('activation_codes'); renderAdminCodes(); renderAdminStats(); }
      }
      const ban = e.target.closest('[data-ban-user]');
      if (ban) {
        const user = getTable('users').users.find(u => u.id === ban.dataset.banUser);
        if (user) { user.status = user.status === 'banned' ? 'active' : 'banned'; saveDB('users'); renderAdminUsers($('#user-search')?.value); logAdmin('USER_BAN', `${user.username} → ${user.status}`); }
      }
      const delUser = e.target.closest('[data-delete-user]');
      if (delUser) {
        if (!confirm('Delete this user permanently?')) return;
        const users = getTable('users').users;
        const idx = users.findIndex(u => u.id === delUser.dataset.deleteUser);
        if (idx >= 0) { users.splice(idx, 1); saveDB('users'); renderAdminUsers(); renderAdminStats(); logAdmin('USER_DELETED', delUser.dataset.deleteUser); }
      }
      const edit = e.target.closest('[data-edit-user]');
      if (edit) openEditUserModal(edit.dataset.editUser);
      const appr = e.target.closest('[data-approve-wd]');
      if (appr) processWithdrawal(appr.dataset.approveWd, 'approved');
      const rej = e.target.closest('[data-reject-wd]');
      if (rej) processWithdrawal(rej.dataset.rejectWd, 'rejected');
    });

    const exportUsers = $('#export-users-btn');
    if (exportUsers) exportUsers.addEventListener('click', () => {
      const users = getTable('users').users.filter(u => u.role !== 'admin');
      downloadCSV('mathbot-users.csv', [['Name', 'Username', 'Phone', 'Earnings', 'Referrals', 'Date', 'Status'],
        ...users.map(u => [u.name, u.username, u.phone, u.earnings + u.referralEarnings, u.referralCount, u.registrationDate, u.status])]);
    });

    const exportWd = $('#export-withdrawals-btn');
    if (exportWd) exportWd.addEventListener('click', () => {
      const wds = getTable('withdrawals').withdrawals;
      downloadCSV('mathbot-withdrawals.csv', [['User', 'Amount', 'GCash Name', 'GCash Number', 'Date', 'Status'],
        ...wds.map(w => [w.username, w.amount, w.gcashName, w.gcashNumber, w.dateRequested, w.status])]);
    });
  }

  function processWithdrawal(wdId, status) {
    const wds = getTable('withdrawals').withdrawals;
    const wd = wds.find(w => w.id === wdId);
    if (!wd || wd.status !== 'pending') return;
    const user = getTable('users').users.find(u => u.id === wd.userId);
    if (!user) return;

    wd.status = status;
    wd.processedDate = new Date().toISOString();

    if (status === 'approved') {
      user.totalWithdrawn += wd.amount;
      addNotification(user.id, `Withdrawal of ${formatPHP(wd.amount)} approved!`, 'success');
      logAdmin('WD_APPROVED', `${user.username} ${formatPHP(wd.amount)}`);
    } else {
      addNotification(user.id, `Withdrawal of ${formatPHP(wd.amount)} was rejected. Balance restored.`, 'error');
      logAdmin('WD_REJECTED', `${user.username} ${formatPHP(wd.amount)}`);
    }
    saveDB('withdrawals');
    saveDB('users');
    renderAdminWithdrawals();
    renderAdminStats();
    showToast(`Withdrawal ${status}`, status === 'approved' ? 'success' : 'info');
  }

  function openEditUserModal(userId) {
    const user = getTable('users').users.find(u => u.id === userId);
    if (!user) return;
    const modal = $('#edit-user-modal');
    if (!modal) return;
    $('#edit-user-id').value = user.id;
    $('#edit-name').value = user.name;
    $('#edit-phone').value = user.phone;
    $('#edit-earnings').value = user.earnings;
    modal.classList.add('open');
  }

  function saveEditUser() {
    const id = $('#edit-user-id')?.value;
    const user = getTable('users').users.find(u => u.id === id);
    if (!user) return;
    user.name = $('#edit-name').value.trim();
    user.phone = $('#edit-phone').value.trim();
    user.earnings = parseFloat($('#edit-earnings').value) || 0;
    saveDB('users');
    $('#edit-user-modal')?.classList.remove('open');
    renderAdminUsers($('#user-search')?.value);
    showToast('User updated', 'success');
    logAdmin('USER_EDITED', user.username);
  }

  /* ========== SHARED UI ========== */
  function bindLogout() {
    $$('[data-logout]').forEach(btn => btn.addEventListener('click', handleLogout));
  }

  function bindEditModal() {
    const saveBtn = $('#save-edit-user');
    if (saveBtn) saveBtn.addEventListener('click', saveEditUser);
    $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => {
      btn.closest('.modal')?.classList.remove('open');
    }));
  }

  function initMobileNav() {
    const page = document.body.dataset.page;
    $$('.bottom-nav a').forEach(a => {
      if (a.dataset.nav === page) a.classList.add('active');
    });
  }

  /* ========== PAGE ROUTER ========== */
  async function init() {
    showLoader(true);
    initTheme();
    await loadDBFromFiles();
    showLoader(false);

    const page = document.body.dataset.page;
    bindLogout();
    bindEditModal();
    initMobileNav();

    switch (page) {
      case 'index':
        if (getSession()) {
          window.location.href = getSession().role === 'admin' ? 'admin.html' : 'dashboard.html';
        }
        break;
      case 'login':
        if (getSession()) window.location.href = getSession().role === 'admin' ? 'admin.html' : 'dashboard.html';
        else { const f = $('#login-form'); if (f) f.addEventListener('submit', handleLogin); }
        break;
      case 'register':
        { const f = $('#register-form'); if (f) f.addEventListener('submit', handleRegister); }
        break;
      case 'dashboard': renderDashboard(); break;
      case 'game': initGame(); break;
      case 'withdrawal': initWithdrawal(); break;
      case 'admin': initAdmin(); break;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
