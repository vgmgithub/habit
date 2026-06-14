// app.js — controller + UI for the Habits PWA.
// Vanilla JS, no framework. Data is cached in memory after one load so every
// local action (toggle, navigate) is instant with zero spinners.

import { db, getSetting, setSetting } from './db.js';
import * as M from './model.js';
import { pickQuote } from './quotes.js';
import * as BK from './backup.js';

const BACKUP_KEEP = 2; // dated backups retained in the folder before auto-deleting oldest

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const HABIT_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
  '#ef4444', '#14b8a6', '#6366f1', '#84cc16', '#f97316',
  '#06b6d4', '#a855f7',
];
const HABIT_ICONS = [
  '✅','💧','🏃','📚','🧘','💪','🥗','😴','🦷','🛏️','🚶','🚭',
  '🧹','✍️','🎯','💊','☀️','🌙','🎸','💻','🧠','🙏','📵','🚰',
  '🏋️','🚴','🧴','📖','🎨','💰','🌱','❤️','🤸','🌬️','🪥',
];
const ROUTINES = [
  { key: 'morning',   label: 'Morning routine',   icon: '☀️' },
  { key: 'afternoon', label: 'Afternoon',         icon: '🌤️' },
  { key: 'evening',   label: 'Evening routine',   icon: '🌙' },
  { key: 'anytime',   label: 'Anytime',           icon: '⭐' },
];
const ACCENTS = ['#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#14b8a6'];

// Predefined categories — match the starter library so habits added from
// onboarding auto-tag with these. Cannot be renamed or deleted by the user.
const PREDEFINED_CATEGORIES = ['Health', 'Mindfulness', 'Productivity', 'Personal care'];

// Default wrap-up time used in onboarding & after migration.
const DEFAULT_WRAPUP_TIME = '21:00';

// Categorised starter library used by onboarding and by the empty state.
const HABIT_LIBRARY = [
  { cat: 'Health', emoji: '💚', items: [
    { name: 'Drink water',    icon: '💧', color: '#06b6d4', routine: 'anytime' },
    { name: 'Exercise',       icon: '🏃', color: '#10b981', routine: 'morning' },
    { name: 'Walking',        icon: '🚶', color: '#84cc16', routine: 'evening' },
    { name: 'Stretch',        icon: '🤸', color: '#14b8a6', routine: 'morning' },
    { name: 'Sleep early',    icon: '😴', color: '#6366f1', routine: 'evening' },
    { name: 'Take vitamins',  icon: '💊', color: '#ef4444', routine: 'morning' },
    { name: 'Healthy meal',   icon: '🥗', color: '#22c55e', routine: 'anytime' },
  ]},
  { cat: 'Mindfulness', emoji: '🧘', items: [
    { name: 'Meditate',       icon: '🧘', color: '#8b5cf6', routine: 'morning' },
    { name: 'Deep breathing', icon: '🌬️', color: '#0ea5e9', routine: 'anytime' },
    { name: 'Gratitude',      icon: '🙏', color: '#f59e0b', routine: 'evening' },
    { name: 'No phone in bed',icon: '📵', color: '#64748b', routine: 'evening' },
  ]},
  { cat: 'Productivity', emoji: '🎯', items: [
    { name: 'Read',           icon: '📚', color: '#8b5cf6', routine: 'evening' },
    { name: 'Plan day',       icon: '🎯', color: '#3b82f6', routine: 'morning' },
    { name: 'Deep work',      icon: '💻', color: '#6366f1', routine: 'morning' },
    { name: 'Journaling',     icon: '✍️', color: '#f59e0b', routine: 'evening' },
    { name: 'Learn',          icon: '🧠', color: '#ec4899', routine: 'anytime' },
  ]},
  { cat: 'Personal care', emoji: '🌸', items: [
    { name: 'Brush teeth',    icon: '🦷', color: '#3b82f6', routine: 'morning' },
    { name: 'Floss',          icon: '🪥', color: '#10b981', routine: 'evening' },
    { name: 'Skincare',       icon: '🧴', color: '#ec4899', routine: 'evening' },
    { name: 'Tidy space',     icon: '🧹', color: '#f97316', routine: 'evening' },
  ]},
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  habits: [],
  logsByHabit: new Map(),
  settings: {
    theme: 'auto', accent: '#10b981', pinHash: null, reminders: true,
    wrapUp: { enabled: true, time: DEFAULT_WRAPUP_TIME },
    notificationSound: true, customCategories: [],
    userName: '',
  },
  view: 'today',
  quoteCycle: 0,             // tap-to-cycle offset for the Today motivational quote
  reminderTimers: [],
  wrapupTimer: null,
  trackerMonth: new Date(),  // which month the Tracker tab is showing
  appWasRunning: false,      // true = warm return (don't lock); false = cold start (lock if PIN set)
};

// ---------------------------------------------------------------------------
// Tiny DOM helper
// ---------------------------------------------------------------------------
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
  return e;
}
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function haptic(ms = 8) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }

function toast(msg, opts = {}) {
  const t = h('div', { class: 'toast' + (opts.celebrate ? ' toast-celebrate' : '') }, msg);
  $('#toast-root').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, opts.duration || 2200);
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Soft 2-note Web Audio chime used as a foreground notification sound. Browsers
// generally suppress the OS notification sound when the page that posted the
// notification is focused — so we synthesize one ourselves to make sure the
// user actually hears the reminder. No audio file = no extra bytes.
let _chimeCtx = null;
function playChime() {
  if (state.settings.notificationSound === false) return;
  try {
    _chimeCtx = _chimeCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _chimeCtx;
    // Resume if suspended (autoplay policy) — best effort
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const tone = (freq, when, dur) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + when);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + when + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + when); o.stop(ctx.currentTime + when + dur + 0.02);
    };
    tone(880, 0, 0.38);    // A5
    tone(1318, 0.13, 0.42); // E6
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Data operations
// ---------------------------------------------------------------------------
async function loadAll() {
  const [habits, logs] = await Promise.all([db.getAll('habits'), db.getAll('logs')]);
  state.habits = habits.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const map = new Map();
  for (const l of logs) {
    if (!map.has(l.habitId)) map.set(l.habitId, []);
    map.get(l.habitId).push(l);
  }
  state.logsByHabit = map;
  state.settings.theme    = await getSetting('theme',    localStorage.getItem('ht_theme')  || 'auto');
  state.settings.accent   = await getSetting('accent',   localStorage.getItem('ht_accent') || '#10b981');
  state.settings.pinHash  = await getSetting('pinHash',  null);
  state.settings.reminders= await getSetting('reminders', true);
  // wrapUp replaces the old eveningReminder. Migrate once if present.
  const legacyEvening = await getSetting('eveningReminder', null);
  state.settings.wrapUp = await getSetting('wrapUp', legacyEvening || { enabled: true, time: DEFAULT_WRAPUP_TIME });
  if (legacyEvening && !(await getSetting('wrapUp', null))) {
    await setSetting('wrapUp', state.settings.wrapUp);
  }
  state.settings.notificationSound  = await getSetting('notificationSound', true);
  state.settings.customCategories   = await getSetting('customCategories', []);
  state.settings.userName           = (await getSetting('userName', '') || '').toString();

  // Migrate legacy single `category` field into multi-category `categories[]`.
  // We do this lazily — only when the habit is next saved — to avoid mass-writes
  // on every load. The in-memory copy gets the array immediately.
  for (const habit of state.habits) {
    if (habit.category && !habit.categories) habit.categories = [habit.category];
    if (!habit.categories) habit.categories = [];
  }
}

function logsFor(id) { return state.logsByHabit.get(id) || []; }

// "Active" = visible on Today: not paused, not archived.
function activeHabits() { return state.habits.filter((x) => !x.archived && !x.paused); }
function pausedHabits() { return state.habits.filter((x) =>  x.archived ||  x.paused); }

async function saveHabit(habit) {
  await db.put('habits', habit);
  const i = state.habits.findIndex((x) => x.id === habit.id);
  if (i >= 0) state.habits[i] = habit; else state.habits.push(habit);
  state.habits.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

async function deleteHabit(id) {
  await db.delete('habits', id);
  for (const l of logsFor(id)) await db.delete('logs', l.id);
  state.habits = state.habits.filter((x) => x.id !== id);
  state.logsByHabit.delete(id);
}

async function setLog(habitId, date, status, note = '') {
  const id = `${habitId}|${date}`;
  const arr = logsFor(habitId);
  if (status == null) {
    await db.delete('logs', id);
    state.logsByHabit.set(habitId, arr.filter((l) => l.id !== id));
    return;
  }
  const row = { id, habitId, date, status, note, ts: Date.now() };
  await db.put('logs', row);
  const idx = arr.findIndex((l) => l.id === id);
  if (idx >= 0) arr[idx] = row; else arr.push(row);
  state.logsByHabit.set(habitId, arr);
}

function getLog(habitId, date) {
  return logsFor(habitId).find((l) => l.date === date) || null;
}

async function pauseHabit(habit) {
  habit.paused = true;
  habit.pauseHistory = habit.pauseHistory || [];
  const last = habit.pauseHistory[habit.pauseHistory.length - 1];
  if (!last || last.to != null) habit.pauseHistory.push({ from: M.todayStr(), to: null });
  await saveHabit(habit);
  scheduleReminders();
}
async function resumeHabit(habit) {
  habit.paused = false;
  habit.archived = false; // unify legacy
  const hist = habit.pauseHistory || [];
  const last = hist[hist.length - 1];
  if (last && last.to == null) last.to = M.todayStr();
  await saveHabit(habit);
  scheduleReminders();
}
async function togglePriority(habit) {
  habit.priority = !habit.priority;
  await saveHabit(habit);
}

// ---------------------------------------------------------------------------
// Wrap-up persistence — a wrap-up completion is stored as a log row keyed by
// the special WRAPUP_HABIT_ID. Reasons for individual missed habits are stored
// as normal log rows with status='missed' and a {reason, note} pair.
// ---------------------------------------------------------------------------
function isWrapupDone(date = M.todayStr()) {
  const arr = state.logsByHabit.get(M.WRAPUP_HABIT_ID) || [];
  return arr.some((l) => l.date === date && l.status === 'done');
}
async function setWrapupDone(date = M.todayStr()) {
  const id = `${M.WRAPUP_HABIT_ID}|${date}`;
  const row = { id, habitId: M.WRAPUP_HABIT_ID, date, status: 'done', note: '', ts: Date.now() };
  await db.put('logs', row);
  const arr = state.logsByHabit.get(M.WRAPUP_HABIT_ID) || [];
  const idx = arr.findIndex((l) => l.id === id);
  if (idx >= 0) arr[idx] = row; else arr.push(row);
  state.logsByHabit.set(M.WRAPUP_HABIT_ID, arr);
}
async function setMissed(habitId, date, reason, note = '') {
  const id = `${habitId}|${date}`;
  const row = { id, habitId, date, status: 'missed', reason, note, ts: Date.now() };
  await db.put('logs', row);
  const arr = state.logsByHabit.get(habitId) || [];
  const idx = arr.findIndex((l) => l.id === id);
  if (idx >= 0) arr[idx] = row; else arr.push(row);
  state.logsByHabit.set(habitId, arr);
}

// ---------------------------------------------------------------------------
// Categories — predefined (read-only) + custom (CRUD with no duplicates)
// ---------------------------------------------------------------------------
function habitCategories(habit) {
  if (habit.categories && habit.categories.length) return habit.categories;
  if (habit.category) return [habit.category]; // legacy
  return [];
}
function allCategories() {
  const custom = state.settings.customCategories || [];
  return [...PREDEFINED_CATEGORIES, ...custom];
}
function categoryExists(name) {
  const n = name.trim().toLowerCase();
  return allCategories().some((c) => c.toLowerCase() === n);
}
async function addCustomCategory(name) {
  const n = name.trim();
  if (!n || categoryExists(n)) return false;
  state.settings.customCategories = [...(state.settings.customCategories || []), n];
  await setSetting('customCategories', state.settings.customCategories);
  return true;
}
// Session-only rename map so any open editor can resolve old names → new ones
// when a category is renamed while it was already selected for an in-progress
// edit. Persisted habits are updated directly in IDB by renameCustomCategory.
const _categoryRenames = new Map();
function resolveCategory(name) {
  let cur = name, hops = 0;
  while (_categoryRenames.has(cur) && hops++ < 20) cur = _categoryRenames.get(cur);
  return cur;
}

async function renameCustomCategory(oldName, newName) {
  const n = newName.trim();
  if (!n) return false;
  if (n.toLowerCase() !== oldName.toLowerCase() && categoryExists(n)) return false;
  state.settings.customCategories = (state.settings.customCategories || []).map((c) => c === oldName ? n : c);
  await setSetting('customCategories', state.settings.customCategories);
  // Update habits that referenced the old name
  for (const habit of state.habits) {
    const cats = habit.categories || [];
    if (cats.includes(oldName)) {
      habit.categories = cats.map((c) => c === oldName ? n : c);
      await db.put('habits', habit);
    }
  }
  _categoryRenames.set(oldName, n);
  return true;
}
async function deleteCustomCategory(name) {
  state.settings.customCategories = (state.settings.customCategories || []).filter((c) => c !== name);
  await setSetting('customCategories', state.settings.customCategories);
  for (const habit of state.habits) {
    const cats = habit.categories || [];
    if (cats.includes(name)) {
      habit.categories = cats.filter((c) => c !== name);
      await db.put('habits', habit);
    }
  }
}
function isPredefinedCategory(name) {
  return PREDEFINED_CATEGORIES.includes(name);
}

// ---------------------------------------------------------------------------
// Toggle (the most important interaction — must feel instant)
// ---------------------------------------------------------------------------
async function toggleToday(habit, cardEl) {
  const today = M.todayStr();
  const existing = getLog(habit.id, today);
  const prevStreak = M.currentStreak(habit, M.logMap(logsFor(habit.id)), today);
  const nextStatus = existing && existing.status === 'done' ? null : 'done';

  await setLog(habit.id, today, nextStatus);
  haptic();

  if (state.view === 'today') render(); // re-sort so done sinks within group
  else if (cardEl) updateTodayCard(habit, cardEl);

  if (nextStatus === 'done') {
    const nextStreak = M.currentStreak(habit, M.logMap(logsFor(habit.id)), today);
    const ms = M.reachedMilestone(prevStreak, nextStreak);
    if (ms) toast(`🎉 ${ms}-day streak: ${habit.name}!`, { celebrate: true, duration: 3200 });
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
const app = () => $('#app');

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  render();
}

function render() {
  const v = state.view;
  $('#view-title').textContent = ({
    today: '', tracker: 'Tracker', stats: 'Statistics', insights: 'Insights',
    settings: 'Settings',
  })[v] || '';
  $('#appbar-actions').innerHTML = '';
  // Persistent gear icon (settings) in the app bar — except when we're already
  // on Settings, where it'd be redundant.
  if (v !== 'settings') {
    const gear = h('button', { class: 'icon-btn appbar-icon', 'aria-label': 'Settings' }, '⚙');
    gear.addEventListener('click', () => setView('settings'));
    $('#appbar-actions').appendChild(gear);
  } else {
    // Show a back arrow when on Settings to make the exit obvious
    const back = h('button', { class: 'icon-btn appbar-icon', 'aria-label': 'Back' }, '←');
    back.addEventListener('click', () => setView('today'));
    $('#appbar-actions').appendChild(back);
  }
  app().innerHTML = '';
  removeFab();
  if (v === 'today') renderToday();
  else if (v === 'tracker') renderTracker();
  else if (v === 'stats') renderStats();
  else if (v === 'insights') renderInsights();
  else if (v === 'settings') renderSettings();
  app().scrollTop = 0;
}

function greetingTitle() {
  const hour = new Date().getHours();
  const base = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return state.settings.userName ? `${base}, ${state.settings.userName}` : 'Today';
}

// ----- Today ----------------------------------------------------------------
function todaysHabits() {
  const today = M.todayStr();
  return activeHabits().filter((x) => M.isScheduled(x, today) && !M.isPausedOn(x, today));
}

function renderToday() {
  const today = M.todayStr();
  const due = todaysHabits();
  const root = app();

  // Header — greeting + date on the left, ring + consistency badge on the right
  const hour = new Date().getHours();
  const baseGreet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const greet = state.settings.userName ? `${baseGreet}, ${state.settings.userName}` : baseGreet;
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const cStreak = M.consistencyStreak(activeHabits(), state.logsByHabit, today);
  const rightBlock = h('div', { class: 'today-head-right' });
  if (cStreak > 0) {
    rightBlock.appendChild(h('button', {
      class: 'consistency-badge',
      title: 'Consistency streak — days you showed up',
      onclick: () => setView('insights'),
    }, growthImg(cStreak, 'cs-badge-art'), h('span', { class: 'cs-num' }, String(cStreak))));
  }
  rightBlock.appendChild(progressRing(0, 0));
  root.appendChild(h('div', { class: 'today-head' },
    h('div', { class: 'today-head-text' },
      h('div', { class: 'greet' }, greet),
      h('div', { class: 'today-date' }, dateLabel)),
    rightBlock));

  // Motivational quote — tone from yesterday's completion, flavor from the
  // dominant scheduled category. Hidden only when there are no habits at all.
  const qc = quoteCard(today);
  if (qc) root.appendChild(qc);

  if (!due.length) {
    if (!activeHabits().length) root.appendChild(emptyState());
    else root.appendChild(h('div', { class: 'empty mini' },
      h('div', { class: 'empty-emoji' }, '🌿'),
      h('p', null, 'Nothing scheduled for today. Enjoy your rest!')));
    updateTodayHeader();
    return;
  }

  // Split pending vs done
  const isDoneToday = (x) => { const l = getLog(x.id, today); return !!(l && l.status === 'done'); };
  const pending = due.filter((x) => !isDoneToday(x));
  const done    = due.filter(isDoneToday);

  // Focus = pinned-or-overdue pending (max 3)
  const now = new Date();
  const scored = pending.map((hab) => {
    const stats = M.habitStats(hab, logsFor(hab.id), today);
    return { hab, stats, score: M.priorityScore(hab, stats, now) };
  });
  const focusItems = scored
    .filter((x) => x.hab.priority || x.score >= 30) // pinned OR overdue
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const focusIds = new Set(focusItems.map((x) => x.hab.id));

  if (focusItems.length) {
    root.appendChild(h('div', { class: 'focus-section' },
      h('div', { class: 'group-label focus-label' }, '🎯 Focus now'),
      ...focusItems.map(({ hab }) => todayCard(hab, today))));
  }

  // Routine groups for everything else (pending first, then done)
  const remaining = [...pending.filter((x) => !focusIds.has(x.id)), ...done];
  for (const r of ROUTINES) {
    const group = remaining.filter((x) => (x.routine || 'anytime') === r.key);
    if (!group.length) continue;
    group.sort((a, b) => Number(isDoneToday(a)) - Number(isDoneToday(b)));
    root.appendChild(h('div', { class: 'group-label' }, `${r.icon} ${r.label}`));
    const list = h('div', { class: 'card-list' });
    for (const habit of group) list.appendChild(todayCard(habit, today));
    root.appendChild(list);
  }

  // Wrap-up CTA — appears in the evening if it's near/past wrap-up time and
  // we haven't done it yet today. Tap to open the review sheet.
  const wu = state.settings.wrapUp;
  if (wu && wu.enabled && !isWrapupDone(today)) {
    const [whh, wmm] = (wu.time || DEFAULT_WRAPUP_TIME).split(':').map(Number);
    const now = new Date();
    const wrapMoment = new Date(); wrapMoment.setHours(whh, wmm, 0, 0);
    // Show 30 min before the time and any time after
    if (now >= new Date(wrapMoment.getTime() - 30 * 60 * 1000)) {
      const cta = h('button', { class: 'wrapup-cta' },
        h('span', { class: 'wrapup-cta-emoji' }, '🌙'),
        h('div', { class: 'wrapup-cta-text' },
          h('div', { class: 'wrapup-cta-title' }, 'Daily Wrap-up'),
          h('div', { class: 'wrapup-cta-sub' }, 'Take a minute to reflect on today.')),
        h('span', { class: 'wrapup-cta-arrow' }, '→'));
      cta.addEventListener('click', () => openWrapup());
      root.appendChild(cta);
    }
  }

  // Insight tile (data-driven)
  const ins = M.pickInsight(activeHabits(), state.logsByHabit, today);
  if (ins) {
    root.appendChild(h('div', { class: 'insight-tile' },
      h('span', { class: 'insight-emoji' }, ins.emoji),
      h('span', { class: 'insight-text' }, ins.text)));
  }

  // FAB intentionally NOT shown on Today — new habits are added only from
  // the Habits tab (cleaner separation of daily-use vs. configuration).
  updateTodayHeader();
}

// ---------------------------------------------------------------------------
// Insights view — qualitative companion to Stats
// ---------------------------------------------------------------------------
function renderInsights() {
  const root = app();
  const habits = activeHabits();
  const today = M.todayStr();

  // Consistency streak hero
  const cStreak = M.consistencyStreak(habits, state.logsByHabit, today);
  const bStreak = M.bestConsistencyStreak(habits, state.logsByHabit, today);
  const hero = h('div', { class: 'consistency-hero' },
    growthImg(cStreak, 'cs-hero-art'),
    h('div', { class: 'cs-hero-num' }, String(cStreak)),
    h('div', { class: 'cs-hero-label' }, `day${cStreak === 1 ? '' : 's'} of showing up`),
    h('div', { class: 'cs-hero-sub muted small' },
      bStreak > cStreak ? `Personal best: ${bStreak} days. Keep going${name(', ')}` : 'You can keep this alive even on imperfect days — just finish the Wrap-up.'));
  root.appendChild(hero);

  if (!habits.length) {
    root.appendChild(h('div', { class: 'empty mini' }, h('div', { class: 'empty-emoji' }, '💡'),
      h('p', null, 'Add habits and start tracking — insights will appear here.')));
    return;
  }

  // Headline insight (same picker as Today's tile, but bigger)
  const ins = M.pickInsight(habits, state.logsByHabit, today);
  if (ins) {
    root.appendChild(h('div', { class: 'insight-headline' },
      h('span', { class: 'insight-emoji big' }, ins.emoji),
      h('div', { class: 'insight-text' }, ins.text)));
  }

  // Best day of the week — works on completion logs alone, no reasons needed.
  const bdw = M.bestDayOfWeek(habits, state.logsByHabit);
  if (bdw && bdw.count >= 3) {
    const longDays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    root.appendChild(h('div', { class: 'insight-tile' },
      h('span', { class: 'insight-emoji' }, '📅'),
      h('span', { class: 'insight-text' },
        `${longDays[bdw.dayIdx]} is your strongest day so far — ${bdw.count} completion${bdw.count === 1 ? '' : 's'}.`)));
  }

  // "Why you miss" reason breakdown
  const rb = M.reasonBreakdown(habits, state.logsByHabit, 30, today);
  root.appendChild(sectionLabel('Why you miss (30 days)'));
  if (rb.total === 0) {
    root.appendChild(h('p', { class: 'muted small reason-empty' },
      `Once you start logging reasons in the Daily Wrap-up, this chart will show your patterns — when you tend to skip, and why. Right now: nothing recorded yet${name(', ')}.`));
  } else {
    const wrap = h('div', { class: 'reason-bars' });
    for (const row of rb.rows) {
      if (row.count === 0) continue;
      wrap.appendChild(h('div', { class: 'reason-bar' },
        h('div', { class: 'reason-bar-head' },
          h('span', { class: 'reason-bar-emoji' }, M.reasonEmoji(row.key)),
          h('span', { class: 'reason-bar-label' }, M.reasonLabel(row.key)),
          h('span', { class: 'reason-bar-pct' }, `${row.count} · ${row.pct}%`)),
        h('div', { class: 'pbar-track' }, h('div', { class: 'pbar-fill', style: { width: row.pct + '%', background: 'var(--accent)' } }))));
    }
    root.appendChild(wrap);
  }

  // Per-habit reason patterns
  const patterns = [];
  for (const ht of habits) {
    const tr = M.topReasonForHabit(ht, logsFor(ht.id), 60, today);
    if (tr && tr.count >= 2) patterns.push({ habit: ht, tr });
  }
  if (patterns.length) {
    root.appendChild(sectionLabel('Habit patterns'));
    const list = h('div', { class: 'pattern-list' });
    for (const p of patterns.sort((a, b) => b.tr.count - a.tr.count)) {
      list.appendChild(h('div', { class: 'pattern-row' },
        h('span', { class: 'hicon sm', style: { background: tint(p.habit.color), color: p.habit.color } }, p.habit.icon || '✅'),
        h('div', { class: 'pattern-text' },
          h('b', null, p.habit.name),
          h('span', { class: 'muted small' }, ` — usually missed because of "${M.reasonLabel(p.tr.key).toLowerCase()}" (${p.tr.count}×)`))));
    }
    root.appendChild(list);
  }
}

// ---------------------------------------------------------------------------
// Tracker view — printed-sheet style monthly grid (READ ONLY).
// Habits down the side, days across the top, cells coloured from existing logs.
// No interaction beyond month navigation; tracking still happens on Today.
// ---------------------------------------------------------------------------
function renderTracker() {
  const root = app();
  const habits = activeHabits();

  const m = state.trackerMonth;
  const year = m.getFullYear();
  const monthIdx = m.getMonth();
  const today = new Date();
  const isCurrentMonth = (monthIdx === today.getMonth() && year === today.getFullYear());

  // Header — serif title + month navigator
  const header = h('div', { class: 'tracker-header' });
  const titleRow = h('div', { class: 'tracker-title' }, 'HABIT TRACKER');
  header.appendChild(titleRow);

  const navRow = h('div', { class: 'tracker-nav' });
  const prev = h('button', { class: 'tracker-navbtn', 'aria-label': 'Previous month' }, '‹');
  prev.addEventListener('click', () => {
    state.trackerMonth = new Date(year, monthIdx - 1, 1);
    render();
  });
  const next = h('button', { class: 'tracker-navbtn', 'aria-label': 'Next month', disabled: isCurrentMonth }, '›');
  next.addEventListener('click', () => {
    state.trackerMonth = new Date(year, monthIdx + 1, 1);
    render();
  });
  const monthLabel = h('div', { class: 'tracker-month' }, `${M.MONTH_LABELS[monthIdx]} ${year}`);
  navRow.append(prev, monthLabel, next);
  header.appendChild(navRow);
  root.appendChild(header);

  if (!habits.length) {
    root.appendChild(h('div', { class: 'empty mini' }, h('div', { class: 'empty-emoji' }, '📔'),
      h('p', null, 'Add some habits on the Habits tab and they\'ll show up here.')));
    return;
  }

  // Number of days in this month
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const todayDate = M.todayStr();

  // Outer scroll container + sticky grid
  const scrollWrap = h('div', { class: 'tracker-wrap' });
  // Grid: 1 name column + N day columns
  const grid = h('div', {
    class: 'tracker-grid',
    style: { gridTemplateColumns: `110px repeat(${daysInMonth}, 28px)` },
  });

  // ---- header row 1: weekday initial (S M T W T F S) ----
  grid.appendChild(h('div', { class: 'tg-cell tg-corner tg-dow-corner' }));
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, monthIdx, d).getDay();
    const ds = M.ymd(new Date(year, monthIdx, d));
    const isToday = ds === todayDate;
    grid.appendChild(h('div', { class: 'tg-cell tg-dow' + (isToday ? ' tg-today-col' : '') },
      M.WEEKDAY_LABELS[dow].charAt(0)));
  }

  // ---- header row 2: day number (1, 2, 3, ...) ----
  grid.appendChild(h('div', { class: 'tg-cell tg-corner tg-day-corner' }, 'HABIT'));
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = M.ymd(new Date(year, monthIdx, d));
    const isToday = ds === todayDate;
    grid.appendChild(h('div', { class: 'tg-cell tg-day' + (isToday ? ' tg-today-col tg-today-num' : '') }, String(d)));
  }

  // ---- one row per habit ----
  for (const habit of habits) {
    // First cell: habit icon + name (sticky-left column)
    grid.appendChild(h('div', { class: 'tg-cell tg-name' },
      h('span', { class: 'tg-name-ico', style: { background: tint(habit.color), color: habit.color } }, habit.icon || '✅'),
      h('span', { class: 'tg-name-text' }, habit.name)));

    // 1 cell per day of month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, monthIdx, d);
      const ds = M.ymd(dateObj);
      const log = getLog(habit.id, ds);
      const isFuture = dateObj > today && ds !== todayDate;
      const paused = M.isPausedOn(habit, ds);
      const scheduled = M.isScheduled(habit, ds);
      const isToday = ds === todayDate;

      let cls = 'tg-cell tg-day-cell';
      if (isToday) cls += ' tg-today-col';
      if (isFuture) cls += ' tg-future';
      else if (paused) cls += ' tg-paused';
      else if (!scheduled) cls += ' tg-off';
      else if (log && log.status === 'done') cls += ' tg-done';
      else if (log && log.status === 'skipped') cls += ' tg-skip';
      else if (log && log.status === 'missed') cls += ' tg-missed';

      const style = (log && log.status === 'done') ? { background: habit.color } : null;
      const cell = h('div', { class: cls, style }, h('span', { class: 'tg-glyph' }, glyphFor(log, paused, scheduled, isFuture)));

      // tooltip with date + status + reason + note (helpful on desktop hover)
      const ttBits = [ds];
      if (log && log.status) ttBits.push(log.status);
      if (log && log.reason) ttBits.push(M.reasonLabel(log.reason));
      if (log && log.note) ttBits.push('“' + log.note.slice(0, 60) + (log.note.length > 60 ? '…' : '') + '”');
      cell.title = ttBits.join(' · ');

      // Tiny note marker (read-only) in corner when this day has a note
      if (log && log.note && log.note.trim()) {
        cell.appendChild(h('span', { class: 'tg-note-mark', 'aria-hidden': 'true' }, '·'));
      }
      grid.appendChild(cell);
    }
  }

  scrollWrap.appendChild(grid);
  root.appendChild(scrollWrap);
}

// Map a log row to the single character that goes inside the tracker cell.
function glyphFor(log, paused, scheduled, isFuture) {
  if (isFuture) return '';
  if (paused) return '';
  if (!scheduled) return '';
  if (!log) return '';
  if (log.status === 'done') return '✓';
  if (log.status === 'skipped') return '⤼';
  if (log.status === 'missed') return '×';
  return '';
}

// Small helper: returns a trailing-comma + name (or empty string) so we can
// drop the user's name into insight sentences without making it required.
function name(prefix = ' ') {
  return state.settings.userName ? `${prefix}${state.settings.userName}` : '';
}

// One-time name prompt for users who upgraded from the pre-name version.
function askNameOnce() {
  const input = h('input', { class: 'field', type: 'text', placeholder: 'Your name (optional)', maxlength: '30' });
  const body = h('div', null,
    h('p', null, 'Quick — what should we call you? Used in greetings and the Daily Wrap-up.'),
    input,
    h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'You can change or clear this anytime from Settings → Profile.'));
  const save = h('button', { class: 'btn btn-primary wide' }, 'Save');
  save.addEventListener('click', async () => {
    const n = input.value.trim();
    state.settings.userName = n;
    await setSetting('userName', n);
    closeModal();
    if (n) toast(`Hi, ${n}`);
    render();
  });
  const skip = h('button', { class: 'btn wide' }, 'Skip for now');
  skip.addEventListener('click', async () => {
    // Persist empty so we don't ask again
    await setSetting('userName', '');
    state.settings.userName = '';
    closeModal();
  });
  openModal('One quick thing', body, [save, skip]);
  setTimeout(() => input.focus(), 150);
}

function todayCard(habit, today) {
  const log = getLog(habit.id, today);
  const done = log && log.status === 'done';
  const skipped = log && log.status === 'skipped';
  const stats = M.habitStats(habit, logsFor(habit.id), today);

  const card = h('div', {
    class: 'hcard' + (done ? ' done' : '') + (skipped ? ' skipped' : '') + (habit.priority ? ' priority' : ''),
    dataset: { card: habit.id },
  });

  const iconChip = h('div', { class: 'hicon', style: { background: tint(habit.color), color: habit.color } }, habit.icon || '✅');

  const sub = h('div', { class: 'hsub' }, subText(habit, stats));
  const titleRow = h('div', { class: 'hname-row' },
    habit.priority ? h('span', { class: 'priority-pin', title: 'Priority' }, '★') : null,
    h('span', { class: 'hname' }, habit.name));
  const body = h('div', { class: 'hbody' }, titleRow, sub);
  body.addEventListener('click', () => openDetail(habit));

  const skipBtn = h('button', { class: 'skip' + (skipped ? ' on' : ''), 'aria-label': 'Skip ' + habit.name, title: 'Skip today' }, '⤼');
  skipBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSkipToday(habit); });

  const check = h('button', { class: 'check', 'aria-label': 'Mark ' + habit.name },
    h('span', { class: 'check-mark' }, '✓'));
  check.addEventListener('click', (e) => { e.stopPropagation(); toggleToday(habit, card); });

  const actions = h('div', { class: 'hcard-actions' }, skipBtn, check);
  card.append(iconChip, body, actions);
  return card;
}

async function toggleSkipToday(habit) {
  const today = M.todayStr();
  const existing = getLog(habit.id, today);
  const next = existing && existing.status === 'skipped' ? null : 'skipped';
  await setLog(habit.id, today, next);
  haptic();
  if (state.view === 'today') render();
}

function subText(habit, stats) {
  const bits = [];
  if (stats.cur > 0) bits.push(`🔥 ${stats.cur}`);
  if (habit.frequency && habit.frequency.type === 'weekly') bits.push(`${stats.weekDone}/${stats.weekTarget} this week`);
  if (habit.reminder && habit.reminder.enabled) bits.push(`⏰ ${habit.reminder.time}`);
  const cats = habitCategories(habit);
  if (cats.length === 1) bits.push(cats[0]);
  else if (cats.length > 1) bits.push(`${cats[0]} +${cats.length - 1}`);
  return bits.join('  ·  ') || 'Tap ✓ when done';
}

function updateTodayCard(habit, card) {
  const today = M.todayStr();
  const log = getLog(habit.id, today);
  const done = log && log.status === 'done';
  const skipped = log && log.status === 'skipped';
  card.classList.toggle('done', !!done);
  card.classList.toggle('skipped', !!skipped);
  const stats = M.habitStats(habit, logsFor(habit.id), today);
  const sub = $('.hsub', card);
  if (sub) sub.textContent = subText(habit, stats);
}

function updateTodayHeader() {
  const today = M.todayStr();
  const due = todaysHabits();
  const total = due.length;
  const done = due.filter((x) => { const l = getLog(x.id, today); return l && l.status === 'done'; }).length;
  const ring = $('.progress-ring');
  if (ring) ring.replaceWith(progressRing(done, total));
}

function progressRing(done, total) {
  const pct = total ? done / total : 0;
  const r = 26, c = 2 * Math.PI * r;
  const wrap = h('div', { class: 'progress-ring' });
  wrap.innerHTML = `
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="${r}" class="ring-bg"/>
      <circle cx="32" cy="32" r="${r}" class="ring-fg"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(1)}"
        transform="rotate(-90 32 32)"/>
    </svg>
    <div class="ring-label"><b>${done}</b><span>/${total}</span></div>`;
  return wrap;
}

function emptyState() {
  const wrap = h('div', { class: 'empty' },
    h('div', { class: 'empty-emoji' }, '🌱'),
    h('h2', null, state.settings.userName ? `Hey ${state.settings.userName}, start a few habits` : 'Start a few habits'),
    h('p', null, 'Pick from the starter library — Health, Mindfulness, Productivity, Personal care — or design your own.'));
  const browse = h('button', { class: 'btn btn-primary wide' }, '✨ Browse starter habits');
  browse.addEventListener('click', () => openOnboarding());
  const custom = h('button', { class: 'btn wide' }, '+ Create custom habit');
  custom.addEventListener('click', () => openEditor());
  wrap.appendChild(browse);
  wrap.appendChild(custom);
  return wrap;
}

// ----- Onboarding (single sheet: Name + Wrap-up time + Starter habits) -----
function openOnboarding() {
  const selected = new Map(); // key -> item
  const body = h('div', { class: 'onboarding' });

  // 1. Name
  body.appendChild(h('div', { class: 'section-label' }, 'What should we call you?'));
  const nameInput = h('input', { class: 'field', type: 'text', placeholder: 'Your name (optional)', value: state.settings.userName || '', maxlength: '30' });
  body.appendChild(nameInput);
  body.appendChild(h('p', { class: 'muted small', style: { marginTop: '6px' } },
    'Shown in greetings throughout the app. Leave blank to keep it neutral — you can change it anytime in Settings.'));

  // 2. Wrap-up time (mandatory, no toggle here — disable lives in Settings)
  body.appendChild(h('div', { class: 'section-label', style: { marginTop: '20px' } }, 'Daily Wrap-up time'));
  const wuTimeInput = h('input', { class: 'field narrow', type: 'time', value: state.settings.wrapUp?.time || DEFAULT_WRAPUP_TIME });
  body.appendChild(h('div', { class: 'inline' }, h('span', { class: 'muted small' }, 'Each day at'), wuTimeInput));
  body.appendChild(h('p', { class: 'muted small', style: { marginTop: '6px' } },
    'A gentle nudge in the evening to reflect on your day. If a habit was missed, you’ll be asked why — these reasons power your insights later, and they keep your Consistency streak alive even on imperfect days.'));

  // 3. Starter habits
  body.appendChild(h('div', { class: 'section-label', style: { marginTop: '20px' } }, 'Pick a few habits to start'));
  body.appendChild(h('p', { class: 'muted small', style: { marginBottom: '10px' } },
    'Long-term, fewer habits done consistently beats many done sometimes.'));

  for (const group of HABIT_LIBRARY) {
    body.appendChild(h('div', { class: 'group-label' }, `${group.emoji} ${group.cat}`));
    const grid = h('div', { class: 'lib-grid' });
    for (const item of group.items) {
      const key = `${group.cat}|${item.name}`;
      const chip = h('button', { class: 'lib-chip', style: { '--c': item.color } },
        h('div', { class: 'lib-ico', style: { background: tint(item.color), color: item.color } }, item.icon),
        h('span', { class: 'lib-name' }, item.name),
        h('span', { class: 'lib-check' }, '✓'));
      chip.addEventListener('click', () => {
        if (selected.has(key)) { selected.delete(key); chip.classList.remove('on'); }
        else { selected.set(key, { ...item, _cat: group.cat }); chip.classList.add('on'); }
        updatePrimary();
      });
      grid.appendChild(chip);
    }
    body.appendChild(grid);
  }

  const primary = h('button', { class: 'btn btn-primary wide' }, 'Start tracking');
  function updatePrimary() {
    const n = selected.size;
    primary.textContent = n === 0 ? 'Start tracking' : `Start with ${n} habit${n === 1 ? '' : 's'}`;
  }
  primary.addEventListener('click', async () => {
    // Persist name + wrap-up time
    const name = nameInput.value.trim();
    state.settings.userName = name;
    await setSetting('userName', name);
    state.settings.wrapUp = { ...state.settings.wrapUp, time: wuTimeInput.value || DEFAULT_WRAPUP_TIME, enabled: true };
    await setSetting('wrapUp', state.settings.wrapUp);
    // Create selected habits
    for (const item of selected.values()) {
      await createHabit({
        name: item.name, icon: item.icon, color: item.color, routine: item.routine,
        categories: item._cat ? [item._cat] : [],
      });
    }
    closeModal();
    if (selected.size) toast(`Welcome${name ? ', ' + name : ''}! ${selected.size} habit${selected.size === 1 ? '' : 's'} ready.`);
    else if (name) toast(`Welcome, ${name}!`);
    scheduleReminders();
    render();
  });

  openModal('Welcome — let’s set things up', body, [primary]);
}

// ----- Stats ----------------------------------------------------------------
function renderStats() {
  const root = app();
  const habits = activeHabits();
  const today = M.todayStr();
  if (!habits.length) {
    root.appendChild(h('div', { class: 'empty mini' }, h('div', { class: 'empty-emoji' }, '📊'),
      h('p', null, 'Add habits to see your progress here.')));
    return;
  }

  // Top tiles — leaner, four focused metrics.
  let totalDone = 0;
  for (const ht of habits) {
    const s = M.habitStats(ht, logsFor(ht.id), today);
    totalDone += s.totalDone;
  }
  const cStreak = M.consistencyStreak(habits, state.logsByHabit, today);
  const wk = M.thisWeekCompletion(habits, state.logsByHabit, today);
  const mo = M.thisMonthCompletion(habits, state.logsByHabit, today);
  const tiles = h('div', { class: 'tiles' },
    tile(growthImg(cStreak, 'tile-growth-art'), cStreak, 'Consistency streak'),
    tile('🗓️', `${wk.pct}%`, `Week (${wk.done}/${wk.sched})`),
    tile('📆', `${mo.pct}%`, `Month (${mo.done}/${mo.sched})`),
    tile('✅', totalDone, 'Total done'),
  );
  root.appendChild(tiles);

  // Find the most-completed habit (lifetime done). Only one habit can wear the
  // sticker — the first habit to reach the max if there's a tie.
  let mostDoneHabit = null, mostDoneCount = 0;
  for (const ht of habits) {
    const total = (logsFor(ht.id) || []).filter((l) => l.status === 'done').length;
    if (total > mostDoneCount) { mostDoneCount = total; mostDoneHabit = ht; }
  }

  // Per-habit cards
  for (const habit of habits) {
    const s = M.habitStats(habit, logsFor(habit.id), today);
    const card = h('div', { class: 'stat-card' });

    const nameLine = h('div', { class: 'stat-name-line' }, h('b', null, habit.name));
    if (habit === mostDoneHabit) {
      nameLine.appendChild(h('span', { class: 'top-sticker', title: 'Most completed habit' }, '🏆'));
    }
    const nameRow = h('div', { class: 'stat-title' },
      nameLine,
      h('span', null, freqLabel(habit)));

    card.appendChild(h('div', { class: 'stat-head' },
      h('div', { class: 'hicon sm', style: { background: tint(habit.color), color: habit.color } }, habit.icon || '✅'),
      nameRow));

    card.appendChild(h('div', { class: 'stat-row' },
      stat(`🔥 ${s.cur}`, 'Current'),
      stat(`${s.totalDone}`, 'Total')));

    card.appendChild(heatmap(habit, today));
    // Stats is read-only: tapping anywhere on the card opens the notes-only
    // history view. Editing lives in Habits; Done/Skip live in Today.
    card.addEventListener('click', () => openNotesView(habit));
    root.appendChild(card);
  }
}

// Focused read-only view of a single day's status + note. Opens when the
// user taps a specific cell in the Stats heatmap strip.
function openDayDetail(habit, date) {
  const log = getLog(habit.id, date);
  const d = M.parseYmd(date);
  const dateLabel = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const head = h('div', { class: 'detail-head' },
    h('div', { class: 'hicon', style: { background: tint(habit.color), color: habit.color } }, habit.icon || '✅'),
    h('div', null,
      h('div', { class: 'detail-name' }, habit.name),
      h('div', { class: 'muted small' }, dateLabel)));

  let statusText = '—', statusClass = 'none';
  if (M.isPausedOn(habit, date)) { statusText = '⏸ Paused on this day'; statusClass = 'paused'; }
  else if (!log) {
    statusText = M.isScheduled(habit, date) ? '— Not logged' : '— Not scheduled';
    statusClass = 'none';
  } else if (log.status === 'done')    { statusText = '✓ Done';    statusClass = 'done'; }
  else if (log.status === 'skipped')   { statusText = '⤼ Skipped'; statusClass = 'skipped'; }
  else if (log.status === 'missed') {
    statusText = '× Missed';
    if (log.reason) statusText += `  ·  ${M.reasonEmoji(log.reason)} ${M.reasonLabel(log.reason)}`;
    statusClass = 'missed';
  }

  const body = h('div', { class: 'day-detail' }, head,
    h('div', { class: 'day-status ' + statusClass }, statusText));
  if (log && log.note) body.appendChild(h('div', { class: 'day-note' }, log.note));
  else if (log) body.appendChild(h('p', { class: 'muted small' }, 'No note for this day.'));

  openModal('That day', body, []);
}

// Read-only timeline of every note the user has recorded for one habit.
// Reachable only from the Stats tab — no Done / Skip / Edit actions here.
function openNotesView(habit) {
  const notes = (logsFor(habit.id) || [])
    .filter((l) => l.note && l.note.trim())
    .sort((a, b) => b.date.localeCompare(a.date));

  const head = h('div', { class: 'detail-head' },
    h('div', { class: 'hicon', style: { background: tint(habit.color), color: habit.color } }, habit.icon || '✅'),
    h('div', null,
      h('div', { class: 'detail-name' }, habit.name),
      h('div', { class: 'muted small' },
        notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'} recorded`
                     : 'No notes yet')));
  const body = h('div', { class: 'notes-view' }, head);

  if (!notes.length) {
    body.appendChild(h('div', { class: 'empty mini' },
      h('div', { class: 'empty-emoji' }, '📝'),
      h('p', null, 'No notes recorded for this habit yet. Add one from Today when you mark it done — they show up here later.')));
  } else {
    const list = h('div', { class: 'note-list' });
    for (const log of notes) {
      const d = M.parseYmd(log.date);
      const dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const statusIco = log.status === 'done' ? '✓' : log.status === 'skipped' ? '⤼' : log.status === 'missed' ? '×' : '';
      list.appendChild(h('div', { class: 'note-item' },
        h('div', { class: 'note-item-head' },
          h('span', { class: 'note-item-date' }, dateLabel),
          h('span', { class: 'note-item-status ' + (log.status || '') }, statusIco)),
        h('div', { class: 'note-item-text' }, log.note)));
    }
    body.appendChild(list);
  }

  openModal('Notes', body, []);
}

function tile(ico, val, label) {
  return h('div', { class: 'tile' }, h('div', { class: 'tile-ico' }, ico),
    h('div', { class: 'tile-val' }, String(val)), h('div', { class: 'tile-label' }, label));
}
// Growth-stage artwork for the consistency streak (same tiers as demo-consistency.html)
function growthIcon(streak) {
  const tier = streak <= 50 ? 1 : streak <= 100 ? 2 : streak <= 150 ? 3
    : streak <= 200 ? 4 : streak <= 250 ? 5 : 6;
  return `./icons/growth-${tier}.png`;
}
function growthImg(streak, cls) {
  return h('img', { class: cls, src: growthIcon(streak), alt: '' });
}
// Small deterministic string hash → stable per-day quote seed (no flicker on re-render).
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
// Motivational quote card for Today. Returns null when there are no habits.
// Tap to cycle to the next quote in the same bucket.
function quoteCard(today) {
  const habits = activeHabits();
  if (!habits.length) return null;
  const ctx = M.yesterdayQuoteContext(habits, state.logsByHabit, today);
  const seed = hashStr(today + '|' + ctx.tier + '|' + ctx.category) + (state.quoteCycle || 0);
  const qd = pickQuote(ctx.category, ctx.tier, seed);
  const card = h('button', {
    class: `quote-card tier-${qd.tier}`,
    title: 'Tap for another',
    'aria-label': 'Motivational quote — tap for another',
  },
    h('span', { class: 'quote-emoji' }, qd.emoji),
    h('div', { class: 'quote-body' },
      h('p', { class: 'quote-text' }, `“${qd.text}”`),
      qd.author ? h('p', { class: 'quote-author' }, `— ${qd.author}`) : null));
  card.addEventListener('click', () => {
    state.quoteCycle = (state.quoteCycle || 0) + 1;
    const next = quoteCard(today);
    if (next) card.replaceWith(next);
  });
  return card;
}
function stat(val, label) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-val' }, val), h('div', { class: 'stat-lbl' }, label));
}
function progressBar(label, s, color) {
  const pct = s.sched ? Math.round((s.done / s.sched) * 100) : 0;
  return h('div', { class: 'pbar' },
    h('div', { class: 'pbar-head' }, h('span', { class: 'pbar-label' }, label), h('span', { class: 'pbar-val' }, `${s.done}/${s.sched} · ${pct}%`)),
    h('div', { class: 'pbar-track' }, h('div', { class: 'pbar-fill', style: { width: pct + '%', background: color } })));
}

// Horizontal 30-day strip. Today is on the right; container scrolls
// right-aligned by default so the most recent week is visible first.
// Each cell shows a day-of-week initial above and the date below.
function heatmap(habit, today) {
  const cells = M.recentHeatmap(habit, logsFor(habit.id), 30, today);
  const block = h('div', { class: 'heat-block' });
  // Static caption — always visible (no scroll needed) — shows the full date
  // range and a "today" anchor. As the user scrolls left, the inline month
  // markers still announce boundaries.
  const firstD = M.parseYmd(cells[0].date);
  const lastD = M.parseYmd(cells[cells.length - 1].date);
  const fmt = (d) => `${M.MONTH_LABELS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  const sameMonth = firstD.getMonth() === lastD.getMonth();
  const rangeText = sameMonth
    ? `${M.MONTH_LABELS[lastD.getMonth()].slice(0, 3)} ${firstD.getDate()} – ${lastD.getDate()}`
    : `${fmt(firstD)} – ${fmt(lastD)}`;
  block.appendChild(h('div', { class: 'heat-caption' },
    h('span', { class: 'heat-caption-title' }, 'Last 30 days'),
    h('span', { class: 'heat-caption-range' }, rangeText),
  ));
  const wrap = h('div', { class: 'heat-wrap' });
  const strip = h('div', { class: 'heat-strip' });
  cells.forEach((c, idx) => {
    // Month label shows on day-1 cells and on the leftmost cell so the user
    // always knows which month they're looking at when they scroll back.
    const showMonth = c.monthStart || idx === 0;
    const monthLabel = showMonth ? M.MONTH_LABELS[M.parseYmd(c.date).getMonth()].slice(0, 3) : '';
    const colCls = 'heat-col'
      + (c.isToday ? ' today' : '')
      + (c.monthStart ? ' month-start' : '');
    const col = h('div', { class: colCls });
    col.appendChild(h('div', { class: 'heat-month' }, monthLabel));
    col.appendChild(h('div', { class: 'heat-dow' }, M.WEEKDAY_LABELS[c.dow].charAt(0)));
    let cls = 'heat-cell';
    if (c.paused) cls += ' paused';
    else if (c.status === 'done') cls += ' done';
    else if (c.status === 'skipped') cls += ' skip';
    else if (c.status === 'missed') cls += ' missed';
    else if (!c.scheduled) cls += ' off';
    const tt = `${c.date}` + (c.status ? ` · ${c.status}` : '') + (c.reason ? ` · ${M.reasonLabel(c.reason)}` : '');
    const cell = h('div', { class: cls, title: tt, style: c.status === 'done' ? { background: habit.color } : null });
    // Time badge only when (a) habit opts in, (b) cell is done, (c) the log
    // was written on the same calendar date as the cell — so a retro-tick of a
    // past day from the calendar doesn't display today's time on that day.
    if (habit.trackTime && c.status === 'done' && c.ts) {
      const lt = new Date(c.ts);
      const logDay = `${lt.getFullYear()}-${String(lt.getMonth() + 1).padStart(2, '0')}-${String(lt.getDate()).padStart(2, '0')}`;
      if (logDay === c.date) {
        cell.appendChild(h('span', { class: 'heat-time' }, fmtTime(c.ts)));
      }
    }
    // Comment sticker — shown whenever a note has been recorded for this date.
    if (c.note) {
      cell.appendChild(h('span', {
        class: 'note-marker',
        title: 'Note: ' + c.note.slice(0, 80) + (c.note.length > 80 ? '…' : ''),
      }, '📝'));
    }
    cell.addEventListener('click', (e) => { e.stopPropagation(); openDayDetail(habit, c.date); });
    col.appendChild(cell);
    col.appendChild(h('div', { class: 'heat-date' }, String(c.day)));
    strip.appendChild(col);
  });
  wrap.appendChild(strip);
  block.appendChild(wrap);
  // After mount, scroll all the way right so 'today' is the anchored view.
  setTimeout(() => { wrap.scrollLeft = wrap.scrollWidth; }, 0);
  return block;
}

// ----- Habits (manage) ------------------------------------------------------
function manageRow(habit, i, n) {
  // Two-row layout — info on top, actions on the bottom — so the name + meta
  // get the full card width instead of fighting five icon buttons for ~30px.
  const row = h('div', { class: 'manage-row' + (habit.priority ? ' priority' : '') });

  const top = h('div', { class: 'manage-top' },
    h('div', { class: 'hicon sm', style: { background: tint(habit.color), color: habit.color } }, habit.icon || '✅'),
    h('div', { class: 'manage-info' },
      h('div', { class: 'manage-name' },
        habit.priority ? h('span', { class: 'priority-pin small', title: 'Priority' }, '★') : null,
        h('span', null, habit.name)),
      h('div', { class: 'manage-meta' }, buildManageMeta(habit))));
  row.appendChild(top);

  const actions = h('div', { class: 'manage-actions' });
  const pin = h('button', { class: 'icon-btn' + (habit.priority ? ' on' : ''), title: habit.priority ? 'Unpin' : 'Mark priority' }, habit.priority ? '★' : '☆');
  pin.addEventListener('click', async () => { await togglePriority(habit); render(); });
  const up = h('button', { class: 'icon-btn', title: 'Move up', disabled: i === 0 }, '↑');
  up.addEventListener('click', () => reorder(habit, -1));
  const down = h('button', { class: 'icon-btn', title: 'Move down', disabled: i === n - 1 }, '↓');
  down.addEventListener('click', () => reorder(habit, 1));
  const edit = h('button', { class: 'icon-btn', title: 'Edit' }, '✏️');
  edit.addEventListener('click', () => openEditor(habit));
  const pause = h('button', { class: 'icon-btn', title: 'Pause' }, '⏸');
  pause.addEventListener('click', async () => { await pauseHabit(habit); toast(`Paused “${habit.name}” — streak preserved`); render(); });
  actions.append(pin, up, down, edit, pause);
  row.appendChild(actions);
  return row;
}

function buildManageMeta(habit) {
  const bits = [freqLabel(habit)];
  if (habit.reminder && habit.reminder.enabled) bits.push(`⏰ ${habit.reminder.time}`);
  if (habit.repeatEvery) bits.push(`repeats +${habit.repeatEvery}m`);
  const cats = habitCategories(habit);
  if (cats.length) bits.push('🏷 ' + cats.join(', '));
  return bits.join('  ·  ');
}

async function reorder(habit, dir) {
  // reorder within its routine group (matches what the user sees)
  const list = activeHabits().filter((x) => (x.routine || 'anytime') === (habit.routine || 'anytime'));
  const i = list.findIndex((x) => x.id === habit.id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  const ao = a.order ?? i, bo = b.order ?? j;
  a.order = bo; b.order = ao;
  await db.put('habits', a); await db.put('habits', b);
  state.habits.sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  render();
}

// ----- Settings -------------------------------------------------------------
function renderSettings() {
  const root = app();

  // Habits management
  root.appendChild(sectionLabel('Habits'));
  const active = activeHabits();
  const paused = pausedHabits();

  const addBtn = h('button', { class: 'btn btn-primary wide' }, '+ New habit');
  addBtn.addEventListener('click', () => openEditor());
  root.appendChild(addBtn);

  const browse = h('button', { class: 'btn wide' }, '✨ Browse starter library');
  browse.addEventListener('click', () => openOnboarding());
  root.appendChild(browse);

  if (active.length || paused.length) {
    // Group active habits by routine
    for (const r of ROUTINES) {
      const group = active.filter((x) => (x.routine || 'anytime') === r.key);
      if (!group.length) continue;
      root.appendChild(h('div', { class: 'group-label' }, `${r.icon} ${r.label}`));
      const list = h('div', { class: 'manage-list' });
      group.forEach((habit, i) => list.appendChild(manageRow(habit, i, group.length)));
      root.appendChild(list);
    }

    if (paused.length) {
      root.appendChild(h('div', { class: 'group-label' }, '⏸ Paused'));
      const list = h('div', { class: 'manage-list' });
      for (const habit of paused) {
        const row = h('div', { class: 'manage-row paused' });
        row.appendChild(h('div', { class: 'manage-top' },
          h('div', { class: 'hicon sm', style: { background: tint(habit.color), color: habit.color } }, habit.icon || '✅'),
          h('div', { class: 'manage-info' },
            h('div', { class: 'manage-name' }, h('span', null, habit.name)),
            h('div', { class: 'manage-meta' }, freqLabel(habit)))));
        const actions = h('div', { class: 'manage-actions' });
        const resume = h('button', { class: 'icon-btn', title: 'Resume' }, '▶');
        resume.addEventListener('click', async () => { await resumeHabit(habit); toast(`Resumed "${habit.name}"`); render(); });
        const del = h('button', { class: 'icon-btn danger', title: 'Delete' }, '🗑');
        del.addEventListener('click', () => confirmDelete(habit));
        actions.append(resume, del);
        row.appendChild(actions);
        list.appendChild(row);
      }
      root.appendChild(list);
    }
  } else {
    root.appendChild(h('div', { class: 'empty mini' }, h('div', { class: 'empty-emoji' }, '📋'),
      h('p', null, 'No habits yet. Pick from the library above or create your own.')));
  }

  root.appendChild(sectionLabel('Settings'));

  // Profile (name)
  root.appendChild(sectionLabel('Profile'));
  const nameInput = h('input', { class: 'field', type: 'text', placeholder: 'Your name', value: state.settings.userName || '', maxlength: '30' });
  nameInput.addEventListener('change', async () => {
    state.settings.userName = nameInput.value.trim();
    await setSetting('userName', state.settings.userName);
    toast(state.settings.userName ? `Hi, ${state.settings.userName}` : 'Name cleared');
  });
  root.appendChild(settingRow('Name', nameInput, "Shown in greetings throughout the app. You can change or clear it anytime."));

  // Appearance
  root.appendChild(sectionLabel('Appearance'));
  const themeSeg = segmented(['auto', 'light', 'dark'], state.settings.theme, async (v) => {
    state.settings.theme = v; localStorage.setItem('ht_theme', v); await setSetting('theme', v); applyTheme();
  }, { auto: 'Auto', light: 'Light', dark: 'Dark' });
  root.appendChild(settingRow('Theme', themeSeg));

  const swatches = h('div', { class: 'swatches' });
  for (const c of ACCENTS) {
    const b = h('button', { class: 'swatch' + (c === state.settings.accent ? ' on' : ''), style: { background: c }, 'aria-label': 'accent' });
    b.addEventListener('click', async () => {
      state.settings.accent = c; localStorage.setItem('ht_accent', c); await setSetting('accent', c);
      document.documentElement.style.setProperty('--accent', c);
      applyThemeColorMeta();
      renderSettings();
    });
    swatches.appendChild(b);
  }
  root.appendChild(settingRow('Accent color', swatches));

  // Reminders
  root.appendChild(sectionLabel('Reminders'));

  // Wrap-up (replaces the old evening-summary reminder)
  const wu = state.settings.wrapUp;
  const wuToggle = toggle(wu.enabled, async (on) => {
    state.settings.wrapUp = { ...wu, enabled: on };
    await setSetting('wrapUp', state.settings.wrapUp);
    if (on) await enableNotifications();
    scheduleReminders();
    renderSettings();
  });
  const wuTime = h('input', { class: 'field narrow', type: 'time', value: wu.time || DEFAULT_WRAPUP_TIME });
  wuTime.disabled = !wu.enabled;
  wuTime.addEventListener('change', async () => {
    state.settings.wrapUp = { ...state.settings.wrapUp, time: wuTime.value || DEFAULT_WRAPUP_TIME };
    await setSetting('wrapUp', state.settings.wrapUp);
    scheduleReminders();
  });
  root.appendChild(settingRow('Daily Wrap-up', h('div', { class: 'inline' }, wuToggle, wuTime),
    'At this time we ask why any habits were missed — keeps the Consistency streak alive.'));

  // Notification sound (foreground chime) + vibrate is always sent so OS will
  // ring/vibrate on phones; this toggle controls our in-app chime when the app
  // is focused (the OS sound is usually suppressed in that case).
  const sndToggle = toggle(state.settings.notificationSound !== false, async (on) => {
    state.settings.notificationSound = on;
    await setSetting('notificationSound', on);
    if (on) playChime(); // small preview so the user hears what they enabled
  });
  root.appendChild(settingRow('Notification sound', sndToggle,
    'Plays a soft chime when the app is open. On phones, notifications also vibrate.'));

  const permState = ('Notification' in window) ? Notification.permission : 'unsupported';
  if (permState !== 'granted') {
    const btn = h('button', { class: 'btn' }, permState === 'unsupported' ? 'Notifications not supported' : 'Allow notifications');
    if (permState !== 'unsupported') btn.addEventListener('click', async () => { await enableNotifications(); renderSettings(); });
    else btn.disabled = true;
    root.appendChild(settingRow('Permission', btn));
  }
  root.appendChild(noteRow('Notifications fire reliably while the app is open. Background delivery depends on your browser; the app is built to avoid notification spam — repeats only continue until the habit is marked done.'));

  // Categories management
  root.appendChild(sectionLabel('Categories'));
  const catBtn = h('button', { class: 'btn' }, '🏷 Manage categories');
  catBtn.addEventListener('click', () => openManageCategories(() => { /* settings doesn't need a re-render here */ }));
  const customCount = (state.settings.customCategories || []).length;
  root.appendChild(settingRow('Categories', catBtn,
    `${PREDEFINED_CATEGORIES.length} predefined · ${customCount} custom. Used to tag habits and surface category insights.`));

  // Privacy & Data
  root.appendChild(sectionLabel('Privacy & Data'));
  const pinBtn = h('button', { class: 'btn' }, state.settings.pinHash ? 'Change / remove PIN' : 'Set PIN lock');
  pinBtn.addEventListener('click', () => state.settings.pinHash ? changePinFlow() : setPinFlow());
  root.appendChild(settingRow('App lock (PIN)', pinBtn, state.settings.pinHash ? 'PIN is set.' : 'Require a 4-digit PIN to open the app.'));

  const backupBtn = h('button', { class: 'btn' }, '🗄️ Backup & Restore');
  backupBtn.addEventListener('click', openBackupRestore);
  root.appendChild(settingRow('Backup & Restore', backupBtn,
    BK.fileSystemAccessSupported()
      ? 'Save backups to a folder you choose, then restore in one tap. Files survive clearing site data.'
      : 'Download a backup file and restore it later.'));

  // Check for updates — manual SW activation
  const updateBtn = h('button', { class: 'btn' }, window.__updateReady ? '⬇️ Update available' : '🔄 Check for updates');
  updateBtn.addEventListener('click', checkForUpdates);
  root.appendChild(settingRow('App updates', updateBtn,
    window.__updateReady
      ? 'A new version is ready to install — tap to apply and reload.'
      : 'Pull the latest version from the server.'));

  const clearBtn = h('button', { class: 'btn danger' }, 'Erase all data');
  clearBtn.addEventListener('click', confirmClearAll);
  root.appendChild(settingRow('Danger zone', clearBtn));

  // About / privacy promise
  root.appendChild(sectionLabel('About'));
  root.appendChild(h('div', { class: 'about' },
    h('p', null, h('b', null, '🔒 Private by design. '), 'No accounts, no analytics, no telemetry, no cloud. All data lives on this device only.'),
    h('p', { class: 'muted' }, 'Habits — offline-first PWA. Works fully without internet.')));
}

function sectionLabel(t) { return h('div', { class: 'section-label' }, t); }
function settingRow(label, control, hint) {
  return h('div', { class: 'setting-row' },
    h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, label), hint ? h('div', { class: 'setting-hint' }, hint) : null),
    h('div', { class: 'setting-control' }, control));
}
function noteRow(t) { return h('div', { class: 'note-row' }, t); }

function segmented(values, current, onChange, labels = {}) {
  const wrap = h('div', { class: 'segmented' });
  for (const v of values) {
    const b = h('button', { class: 'seg' + (v === current ? ' on' : '') }, labels[v] || v);
    b.addEventListener('click', () => { onChange(v); wrap.querySelectorAll('.seg').forEach((s) => s.classList.remove('on')); b.classList.add('on'); });
    wrap.appendChild(b);
  }
  return wrap;
}
function toggle(on, onChange) {
  const t = h('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on) }, h('span', { class: 'knob' }));
  t.addEventListener('click', () => { on = !on; t.classList.toggle('on', on); t.setAttribute('aria-checked', String(on)); onChange(on); });
  return t;
}

// ---------------------------------------------------------------------------
// FAB
// ---------------------------------------------------------------------------
function addFab() {
  removeFab();
  const fab = h('button', { class: 'fab', id: 'fab', 'aria-label': 'Add habit' }, '+');
  fab.addEventListener('click', () => openEditor());
  document.body.appendChild(fab);
}
function removeFab() { const f = $('#fab'); if (f) f.remove(); }

// ---------------------------------------------------------------------------
// Habit editor (add / edit)
// ---------------------------------------------------------------------------
function blankHabit() {
  return {
    id: uid(), name: '', icon: '✅', color: HABIT_COLORS[0], categories: [], routine: 'anytime',
    frequency: { type: 'daily', weeklyTarget: 3, days: [1, 2, 3, 4, 5] },
    reminder: { enabled: false, time: '09:00' },
    repeatEvery: 0,
    notesEnabled: true,
    trackTime: false,   // when on, show HH:MM badge on each done heatmap cell
    priority: false, paused: false, pauseHistory: [],
    createdAt: new Date().toISOString(), archived: false,
    order: (state.habits.reduce((m, x) => Math.max(m, x.order ?? 0), 0)) + 1,
  };
}

async function createHabit(partial) {
  const habit = Object.assign(blankHabit(), partial);
  await saveHabit(habit);
  scheduleReminders();
  return habit;
}

function openEditor(existing) {
  const habit = existing ? JSON.parse(JSON.stringify(existing)) : blankHabit();
  const isNew = !existing;

  const nameInput = h('input', { class: 'field', type: 'text', placeholder: 'Habit name', value: habit.name, maxlength: '40' });

  // Icons already used by another (active) habit get a "used" tint — still
  // selectable but visually deprioritised so new habits stay distinct.
  const usedIcons = new Set(state.habits.filter((x) => x.id !== habit.id && !x.paused && !x.archived).map((x) => x.icon));
  const iconRow = h('div', { class: 'picker-row' });
  HABIT_ICONS.forEach((ic) => {
    const b = h('button', {
      class: 'pick' + (ic === habit.icon ? ' on' : '') + (usedIcons.has(ic) ? ' used' : ''),
      title: usedIcons.has(ic) ? 'Already used by another habit' : null,
    }, ic);
    b.addEventListener('click', () => { habit.icon = ic; iconRow.querySelectorAll('.pick').forEach((x) => x.classList.remove('on')); b.classList.add('on'); });
    iconRow.appendChild(b);
  });
  const usedColors = new Set(state.habits.filter((x) => x.id !== habit.id && !x.paused && !x.archived).map((x) => x.color));
  const colorRow = h('div', { class: 'picker-row' });
  HABIT_COLORS.forEach((c) => {
    const b = h('button', {
      class: 'pick-color' + (c === habit.color ? ' on' : '') + (usedColors.has(c) ? ' used' : ''),
      style: { background: c },
      title: usedColors.has(c) ? 'Already used' : null,
    });
    b.addEventListener('click', () => { habit.color = c; colorRow.querySelectorAll('.pick-color').forEach((x) => x.classList.remove('on')); b.classList.add('on'); });
    colorRow.appendChild(b);
  });

  // Frequency
  const freqSeg = segmented(['daily', 'weekly', 'custom'], habit.frequency.type, (v) => {
    habit.frequency.type = v; freqExtra.innerHTML = ''; freqExtra.appendChild(freqExtraEl());
  }, { daily: 'Daily', weekly: 'X / week', custom: 'Days' });
  const freqExtra = h('div', { class: 'freq-extra' });
  function freqExtraEl() {
    if (habit.frequency.type === 'weekly') {
      const num = h('input', { class: 'field narrow', type: 'number', min: '1', max: '7', value: String(habit.frequency.weeklyTarget || 3) });
      num.addEventListener('input', () => { habit.frequency.weeklyTarget = Math.max(1, Math.min(7, +num.value || 1)); });
      return h('div', { class: 'inline' }, h('span', null, 'Target'), num, h('span', null, 'times per week'));
    }
    if (habit.frequency.type === 'custom') {
      const wrap = h('div', { class: 'weekday-row' });
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((lbl, idx) => {
        const on = (habit.frequency.days || []).includes(idx);
        const b = h('button', { class: 'wday' + (on ? ' on' : '') }, lbl);
        b.addEventListener('click', () => {
          const set = new Set(habit.frequency.days || []);
          if (set.has(idx)) set.delete(idx); else set.add(idx);
          habit.frequency.days = [...set].sort();
          b.classList.toggle('on');
        });
        wrap.appendChild(b);
      });
      return wrap;
    }
    return h('div', { class: 'muted small' }, 'Every day.');
  }
  freqExtra.appendChild(freqExtraEl());

  const routineSeg = segmented(ROUTINES.map((r) => r.key), habit.routine, (v) => { habit.routine = v; },
    Object.fromEntries(ROUTINES.map((r) => [r.key, r.label.replace(' routine', '')])));

  // Multi-select category chips. Predefined ones are read-only; custom ones
  // are managed via the "⚙ Manage" chip. Uniqueness is enforced case-insensitively.
  const selectedCats = new Set(habitCategories(habit));
  const catPicker = h('div', { class: 'cat-picker' });
  function renderCats() {
    catPicker.innerHTML = '';
    for (const c of allCategories()) {
      const chip = h('button', { class: 'cat-chip' + (selectedCats.has(c) ? ' on' : '') }, c);
      chip.addEventListener('click', () => {
        if (selectedCats.has(c)) selectedCats.delete(c); else selectedCats.add(c);
        chip.classList.toggle('on');
      });
      catPicker.appendChild(chip);
    }
    const addChip = h('button', { class: 'cat-chip add' }, '+ New');
    addChip.addEventListener('click', () => openAddCategoryPrompt(async (name) => {
      selectedCats.add(name);
      renderCats();
    }));
    catPicker.appendChild(addChip);
    const manageChip = h('button', { class: 'cat-chip manage' }, '⚙ Manage');
    manageChip.addEventListener('click', () => openManageCategories(() => {
      // Apply renames + prune deletions, so the editor's selection survives
      // category changes that happened while the manage modal was open.
      const updated = new Set();
      for (const c of selectedCats) updated.add(resolveCategory(c));
      selectedCats.clear();
      const valid = new Set(allCategories());
      for (const c of updated) if (valid.has(c)) selectedCats.add(c);
      renderCats();
    }));
    catPicker.appendChild(manageChip);
  }
  renderCats();

  const timeInput = h('input', { class: 'field narrow', type: 'time', value: habit.reminder.time || '09:00' });
  timeInput.disabled = !habit.reminder.enabled;
  const remToggle = toggle(habit.reminder.enabled, (on) => { habit.reminder.enabled = on; timeInput.disabled = !on; repeatRow.style.display = on ? '' : 'none'; if (on) enableNotifications(); });

  // Repeat reminder (in-app, capped to avoid spam)
  const repeatSeg = segmented(['0', '15', '30', '60'], String(habit.repeatEvery || 0), (v) => { habit.repeatEvery = +v; },
    { '0': 'Off', '15': '+15m', '30': '+30m', '60': '+60m' });
  const repeatRow = h('div', { style: { display: habit.reminder.enabled ? '' : 'none', marginTop: '8px' } },
    h('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'If still incomplete, gently repeat every…'),
    repeatSeg);

  const priorityToggle = toggle(!!habit.priority, (on) => { habit.priority = on; });
  const notesToggle = toggle(habit.notesEnabled !== false, (on) => { habit.notesEnabled = on; });
  const timeToggle  = toggle(!!habit.trackTime,        (on) => { habit.trackTime = on; });

  const body = h('div', { class: 'editor' },
    field('Name', nameInput),
    field('Icon', iconRow),
    field('Color', colorRow),
    field('Frequency', h('div', null, freqSeg, freqExtra)),
    field('Time of day', routineSeg),
    field('Categories', catPicker),
    field('Reminder', h('div', null, h('div', { class: 'inline' }, remToggle, timeInput), repeatRow)),
    field('Priority (Focus today)', priorityToggle),
    field('Daily notes', h('div', null,
      notesToggle,
      h('div', { class: 'muted small', style: { marginTop: '6px' } },
        'When on, a small note field appears when you tap a day on this habit\'s calendar — useful for things like "ran 5 km" or "skipped, felt unwell".'))),
    field('Track completion time', h('div', null,
      timeToggle,
      h('div', { class: 'muted small', style: { marginTop: '6px' } },
        'When on, the heatmap shows the HH:MM you completed this habit each day. Handy for time-sensitive habits like meditation or sleep.'))),
  );

  const save = h('button', { class: 'btn btn-primary wide' }, isNew ? 'Create habit' : 'Save changes');
  save.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.classList.add('err'); nameInput.focus(); return; }
    habit.name = name;
    habit.categories = [...selectedCats];
    delete habit.category; // drop legacy single-value field if present
    habit.reminder.time = timeInput.value || '09:00';
    await saveHabit(habit);
    scheduleReminders();
    closeModal();
    toast(isNew ? 'Habit created' : 'Saved');
    render();
  });

  const footerKids = [save];
  if (!isNew) {
    if (existing.paused || existing.archived) {
      const resume = h('button', { class: 'btn wide' }, '▶ Resume habit');
      resume.addEventListener('click', async () => { await resumeHabit(habit); closeModal(); toast('Resumed'); render(); });
      footerKids.push(resume);
    } else {
      const pause = h('button', { class: 'btn wide' }, '⏸ Pause habit');
      pause.addEventListener('click', async () => { await pauseHabit(habit); closeModal(); toast('Paused — streak preserved'); render(); });
      footerKids.push(pause);
    }
    const del = h('button', { class: 'btn danger wide' }, 'Delete habit');
    del.addEventListener('click', () => confirmDelete(habit));
    footerKids.push(del);
  }

  openModal(isNew ? 'New habit' : 'Edit habit', body, footerKids);
}

function field(label, control) {
  return h('div', { class: 'efield' }, h('label', { class: 'elabel' }, label), control);
}

// ---------------------------------------------------------------------------
// Habit detail (calendar + notes + history)
// ---------------------------------------------------------------------------
// Today's habit-card body opens a focused action sheet — Done / Skip / Note
// for TODAY only. No calendar, no stats, no Edit (edit lives in Habits tab).
function openDetail(habit) {
  const today = M.todayStr();

  const head = h('div', { class: 'detail-head' },
    h('div', { class: 'hicon', style: { background: tint(habit.color), color: habit.color } }, habit.icon || '✅'),
    h('div', null,
      h('div', { class: 'detail-name' }, habit.name),
      h('div', { class: 'muted small' }, freqLabel(habit))));

  const dayPanel = h('div', { class: 'day-panel' });
  dayPanel.appendChild(h('div', { class: 'day-panel-title' }, 'Today'));
  const actionsRow = h('div', { class: 'day-actions' });
  dayPanel.appendChild(actionsRow);

  let noteInput = null;
  function rebuild() {
    actionsRow.innerHTML = '';
    const cur = getLog(habit.id, today);
    const mk = (label, status) => {
      const active = cur && cur.status === status;
      const b = h('button', { class: 'day-act' + (active ? ' on' : '') }, label);
      b.addEventListener('click', async () => {
        const next = active ? null : status;
        await setLog(habit.id, today, next, cur ? cur.note : '');
        rebuild();
      });
      return b;
    };
    actionsRow.append(mk('✓ Done', 'done'), mk('⤼ Skip', 'skipped'));
  }
  rebuild();

  if (habit.notesEnabled !== false) {
    const log = getLog(habit.id, today);
    noteInput = h('textarea', { class: 'field note', placeholder: 'Note for today (optional)', rows: '3' });
    noteInput.value = (log && log.note) || '';
    noteInput.addEventListener('change', async () => {
      const cur = getLog(habit.id, today);
      if (!cur && !noteInput.value.trim()) return;
      const status = cur ? cur.status : 'done';
      await setLog(habit.id, today, status, noteInput.value.trim());
    });
    dayPanel.appendChild(noteInput);
  }

  const body = h('div', { class: 'detail' }, head, dayPanel);
  openModal(habit.name, body, [], () => { render(); });
}

function iconBtn(label, fn) { const b = h('button', { class: 'icon-btn' }, label); b.addEventListener('click', fn); return b; }

// ---------------------------------------------------------------------------
// Confirm dialogs
// ---------------------------------------------------------------------------
function confirmDelete(habit) {
  openConfirm('Delete habit?',
    `“${habit.name}” and all its history will be permanently removed. Tip: pause it instead to keep the history.`,
    'Delete', async () => {
    await deleteHabit(habit.id);
    scheduleReminders();
    closeModal();
    toast('Habit deleted');
    render();
  });
}
function confirmClearAll() {
  openConfirm('Erase everything?', 'All habits, history and settings will be permanently deleted from this device. This cannot be undone.', 'Erase all', async () => {
    await db.clearAll();
    localStorage.removeItem('ht_theme'); localStorage.removeItem('ht_accent');
    closeModal();
    await loadAll();
    applyTheme();
    setView('today');
    toast('All data erased');
  });
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------
// Build the serializable backup object. Excludes pinHash (security) and the
// folder handle (not JSON-serializable; device-local).
async function buildBackupData() {
  return {
    app: 'habittracker', version: 2, exportedAt: new Date().toISOString(),
    habits: await db.getAll('habits'),
    logs: await db.getAll('logs'),
    meta: (await db.getAll('meta')).filter((m) => m.key !== 'pinHash' && m.key !== 'backupFolderHandle'),
  };
}

// REPLACE all data with `data`. Preserves this device's PIN and the saved backup
// folder so the user isn't locked out and the folder stays linked after reload.
async function applyRestore(data) {
  if (!data || !Array.isArray(data.habits)) throw new Error('Invalid backup file');
  const pinRow = await db.get('meta', 'pinHash');
  const folderRow = await db.get('meta', 'backupFolderHandle');
  await db.clearAll();
  await db.bulkPut('habits', data.habits);
  if (Array.isArray(data.logs)) await db.bulkPut('logs', data.logs);
  if (Array.isArray(data.meta)) {
    for (const m of data.meta) {
      if (m.key === 'pinHash' || m.key === 'backupFolderHandle') continue;
      await db.put('meta', m);
    }
  }
  if (pinRow) await db.put('meta', pinRow);
  if (folderRow) await db.put('meta', folderRow);
}

function backupLabel(data) {
  const iso = data && data.exportedAt;
  if (iso) { const d = new Date(iso); if (!isNaN(d)) return M.ymd(d); }
  return 'this file';
}

// Shared restore flow: confirm → best-effort pre-restore snapshot → replace → reload.
function runRestore(data, label, folder) {
  openConfirm('Restore backup',
    `Restore from ${label}? This REPLACES all your current data with the backup. ` +
    `Any edits made since that backup will be lost. A safety snapshot of your current ` +
    `state will be saved as "prerestore" first.`,
    'Restore', async () => {
      closeModal();
      try {
        if (folder && await BK.ensureFolderPermission(folder)) {
          try { await BK.writePreRestoreSnapshot(folder, await buildBackupData()); }
          catch (err) { console.warn('pre-restore snapshot failed (continuing):', err); }
        }
        await applyRestore(data);
        toast(`Restored · ${label} · reloading…`);
        setTimeout(() => location.reload(), 900);
      } catch (err) {
        console.error('restore failed:', err);
        toast('Restore failed — your data is unchanged');
      }
    });
}

// Restore from any file via the OS file picker (outside-folder / fallback path).
async function restoreFromOutsideFile(folder) {
  let data;
  try { data = await BK.readBackupViaFilePicker(); }
  catch (err) { if (err && err.name === 'AbortError') return; toast('Could not read that file'); return; }
  if (!data || !Array.isArray(data.habits)) { toast('That doesn’t look like a valid backup'); return; }
  runRestore(data, backupLabel(data), folder || null);
}

// Legacy download (Downloads folder) — used by the no-FS-API fallback sheet.
async function downloadBackup() {
  const data = await buildBackupData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `habits-backup-${M.todayStr()}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded');
}

// ---------------------------------------------------------------------------
// Backup & Restore — entry point routes to one of three sheets
// ---------------------------------------------------------------------------
async function openBackupRestore() {
  if (!BK.fileSystemAccessSupported()) { openBackupFallbackSheet(); return; }
  const folder = await BK.getSavedFolder();
  if (!folder) { openBackupSetupSheet(); return; }
  openBackupMainSheet(folder);
}

// 1) Fallback (no File System Access API) — download + restore-from-file.
function openBackupFallbackSheet() {
  const now = h('button', { class: 'btn btn-primary wide' }, '⬇︎ Backup now');
  now.addEventListener('click', () => { closeModal(); downloadBackup(); });
  const restore = h('button', { class: 'btn wide' }, '⬆︎ Restore from file');
  restore.addEventListener('click', () => { closeModal(); restoreFromOutsideFile(null); });
  const body = h('div', { class: 'backup-sheet' },
    h('p', { class: 'backup-hint' },
      'This browser can’t save to a folder, so backups download to your device and you restore by picking a file.'),
    h('div', { class: 'backup-actions-col' }, now, restore));
  openModal('Backup & Restore', body);
}

// 2) Setup — no folder chosen yet.
function openBackupSetupSheet() {
  const choose = h('button', { class: 'btn btn-primary wide' }, '📁 Choose backup folder');
  choose.addEventListener('click', async () => {
    let folder;
    try { folder = await BK.pickFolder(); }
    catch (err) { if (!(err && err.name === 'AbortError')) toast('Couldn’t open the folder picker'); return; }
    if (!(await BK.ensureFolderPermission(folder))) { toast('Folder permission was denied'); return; }
    await BK.saveFolder(folder);
    closeModal();
    openBackupMainSheet(folder);
  });
  const restoreLink = h('button', { class: 'linkish' }, 'Restore from a backup file…');
  restoreLink.addEventListener('click', () => { closeModal(); restoreFromOutsideFile(null); });
  const body = h('div', { class: 'backup-sheet' },
    h('p', { class: 'backup-hint' },
      'Pick a folder once (e.g. in Documents or a cloud-synced drive). Every backup saves there, ' +
      'old ones auto-delete, and your recent backups show here for one-tap restore. ' +
      'The files stay even if you clear the browser’s site data.'),
    choose,
    h('div', { class: 'backup-footer' }, restoreLink));
  openModal('Set up backups', body);
}

// 3) Main — folder set + accessible.
async function openBackupMainSheet(folder) {
  const body = h('div', { class: 'backup-sheet' }, h('p', { class: 'muted small' }, 'Loading…'));
  openModal('Backup & Restore', body);

  const granted = await BK.ensureFolderPermission(folder);
  if (!granted) {
    body.innerHTML = '';
    const reconnect = h('button', { class: 'btn btn-primary wide' }, 'Reconnect folder');
    reconnect.addEventListener('click', async () => { if (await BK.ensureFolderPermission(folder)) { closeModal(); openBackupMainSheet(folder); } else toast('Permission denied'); });
    const repick = h('button', { class: 'linkish' }, 'Choose a different folder…');
    repick.addEventListener('click', async () => {
      try { const f = await BK.pickFolder(); if (await BK.ensureFolderPermission(f)) { await BK.saveFolder(f); closeModal(); openBackupMainSheet(f); } }
      catch (err) { if (!(err && err.name === 'AbortError')) toast('Couldn’t pick a folder'); }
    });
    body.appendChild(h('p', { class: 'backup-hint' }, 'Permission to the backup folder is needed again.'));
    body.appendChild(reconnect);
    body.appendChild(h('div', { class: 'backup-footer' }, repick));
    return;
  }

  // Folder row
  const changeLink = h('button', { class: 'linkish' }, 'Change');
  changeLink.addEventListener('click', async () => {
    try { const f = await BK.pickFolder(); if (await BK.ensureFolderPermission(f)) { await BK.saveFolder(f); closeModal(); openBackupMainSheet(f); } }
    catch (err) { if (!(err && err.name === 'AbortError')) toast('Couldn’t pick a folder'); }
  });
  const folderRow = h('div', { class: 'backup-folder-row' },
    h('span', { class: 'backup-folder-ico' }, '📁'),
    h('span', { class: 'backup-folder-name' }, folder.name || 'Backup folder'),
    changeLink);

  // Action row
  const lastAt = await getSetting('lastBackupAt', null);
  const lastText = h('span', { class: 'backup-last muted small' }, lastAt ? `Last: ${lastAt}` : 'No backups yet');
  const nowBtn = h('button', { class: 'btn btn-primary' }, '⬇︎ Backup now');
  nowBtn.addEventListener('click', async () => {
    nowBtn.disabled = true;
    try {
      const data = await buildBackupData();
      const { date } = await BK.writeBackup(folder, data);
      await BK.rotateBackups(folder, BACKUP_KEEP);
      await setSetting('lastBackupAt', date);
      toast(`Backup saved · ${date}`);
      closeModal();
      openBackupMainSheet(folder);
    } catch (err) {
      console.error('backup failed:', err);
      toast('Backup failed');
      nowBtn.disabled = false;
    }
  });
  const actionRow = h('div', { class: 'backup-action-row' }, nowBtn, lastText);

  // Recent backups
  let backups = [];
  try { backups = await BK.listBackups(folder); } catch (err) { console.warn('listBackups failed:', err); }
  const listWrap = h('div', { class: 'backup-list' });
  if (!backups.length) {
    listWrap.appendChild(h('p', { class: 'muted small' }, 'No backups in this folder yet — tap “Backup now”.'));
  } else {
    for (const b of backups.slice(0, BACKUP_KEEP)) {
      const restoreBtn = h('button', { class: 'btn small' }, 'Restore');
      restoreBtn.addEventListener('click', async () => {
        let data;
        try { data = await BK.readBackupByName(folder, b.name); }
        catch (err) { toast('Couldn’t read that backup'); return; }
        runRestore(data, b.date, folder);
      });
      listWrap.appendChild(h('div', { class: 'backup-item' },
        h('div', { class: 'backup-item-info' },
          h('div', { class: 'backup-item-date' }, b.date),
          h('div', { class: 'backup-item-size muted small' }, formatBytes(b.size))),
        restoreBtn));
    }
  }

  // Footer: outside-file restore
  const outsideLink = h('button', { class: 'linkish' }, 'Restore from a file outside this folder…');
  outsideLink.addEventListener('click', () => { closeModal(); restoreFromOutsideFile(folder); });

  body.innerHTML = '';
  body.appendChild(folderRow);
  body.appendChild(actionRow);
  body.appendChild(h('div', { class: 'backup-section-title' }, 'Recent backups'));
  body.appendChild(listWrap);
  body.appendChild(h('div', { class: 'backup-footer' }, outsideLink));
}

function formatBytes(n) {
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---------------------------------------------------------------------------
// Check for updates — manual SW activation
// ---------------------------------------------------------------------------
async function checkForUpdates() {
  if (!('serviceWorker' in navigator)) { toast('Updates not supported'); return; }
  const reg = window.__swReg || await navigator.serviceWorker.getRegistration();
  if (!reg) { toast('SW not registered'); return; }

  // Already waiting — apply now.
  if (reg.waiting) {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    toast('Applying update…');
    return; // page reloads via controllerchange handler
  }

  toast('Checking for updates…');
  try { await reg.update(); }
  catch (e) { toast('Could not reach server — try again later'); return; }

  // If a new SW is now installing, wait for it.
  if (reg.installing) {
    await new Promise((resolve) => {
      const sw = reg.installing;
      const onChange = () => {
        if (sw.state === 'installed' || sw.state === 'activated' || sw.state === 'redundant') {
          sw.removeEventListener('statechange', onChange);
          resolve();
        }
      };
      sw.addEventListener('statechange', onChange);
      setTimeout(() => { sw.removeEventListener('statechange', onChange); resolve(); }, 8000);
    });
  }

  if (reg.waiting) {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    toast('Update found — applying…');
  } else {
    toast('You\'re on the latest version');
  }
}

// ---------------------------------------------------------------------------
// Modal system
// ---------------------------------------------------------------------------
// Modal system supports STACKING — opening a dialog from inside another
// (e.g. "+ New category" from the habit editor) preserves the parent so the
// user returns to where they were when the inner dialog closes.
function openModal(title, body, footerKids = [], onClose) {
  const root = $('#modal-root');
  const sheet = h('div', { class: 'sheet' },
    h('div', { class: 'sheet-handle' }),
    h('div', { class: 'sheet-head' }, h('h2', null, title), closeBtn()),
    h('div', { class: 'sheet-body' }, body),
    footerKids.length ? h('div', { class: 'sheet-foot' }, ...footerKids) : null,
  );
  const overlay = h('div', { class: 'overlay' }, sheet);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
  function close() {
    overlay.classList.remove('show');
    setTimeout(() => { overlay.remove(); if (onClose) onClose(); }, 220);
  }
  overlay._close = close;
  function closeBtn() { const b = h('button', { class: 'icon-btn close', 'aria-label': 'Close' }, '✕'); b.addEventListener('click', close); return b; }
  root.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
}
function closeModal() {
  // Close the topmost overlay (LIFO).
  const overlays = $('#modal-root').querySelectorAll('.overlay');
  const top = overlays[overlays.length - 1];
  if (top && top._close) top._close();
}

// ---------------------------------------------------------------------------
// Category dialogs
// ---------------------------------------------------------------------------
function openAddCategoryPrompt(onAdd) {
  const input = h('input', { class: 'field', type: 'text', placeholder: 'e.g. Fitness, Finance, Family', maxlength: '24' });
  const err = h('div', { class: 'muted small', style: { minHeight: '18px', marginTop: '8px', color: '#ef4444' } });
  const body = h('div', null,
    h('p', { class: 'muted small', style: { marginBottom: '10px' } }, 'Add a new category. Names must be unique (case-insensitive).'),
    input, err);
  const ok = h('button', { class: 'btn btn-primary wide' }, 'Add');
  ok.addEventListener('click', async () => {
    const n = input.value.trim();
    if (!n) { err.textContent = 'Enter a name'; return; }
    if (categoryExists(n)) { err.textContent = '"' + n + '" already exists'; return; }
    const added = await addCustomCategory(n);
    if (!added) { err.textContent = 'Could not add'; return; }
    closeModal();
    onAdd && onAdd(n);
  });
  const cancel = h('button', { class: 'btn wide' }, 'Cancel');
  cancel.addEventListener('click', closeModal);
  openModal('New category', body, [ok, cancel]);
  setTimeout(() => input.focus(), 120);
}

function openManageCategories(onChange) {
  const body = h('div', { class: 'cat-manage' });
  function rerender() {
    body.innerHTML = '';
    const customs = state.settings.customCategories || [];
    body.appendChild(h('div', { class: 'section-label', style: { marginTop: '4px' } }, 'Custom categories'));
    if (!customs.length) {
      body.appendChild(h('p', { class: 'muted small' }, 'No custom categories yet. Tap "+ New category" below to add one.'));
    } else {
      const list = h('div', { class: 'manage-list' });
      for (const c of customs) list.appendChild(catManageRow(c, () => { rerender(); onChange && onChange(); }));
      body.appendChild(list);
    }
    body.appendChild(h('div', { class: 'section-label', style: { marginTop: '18px' } }, 'Predefined (read-only)'));
    const pl = h('div', { class: 'manage-list' });
    for (const c of PREDEFINED_CATEGORIES) {
      pl.appendChild(h('div', { class: 'manage-row paused' },
        h('div', { class: 'manage-info' }, h('div', { class: 'manage-name' }, c))));
    }
    body.appendChild(pl);
  }
  rerender();
  const add = h('button', { class: 'btn btn-primary wide' }, '+ New category');
  add.addEventListener('click', () => {
    openAddCategoryPrompt(() => { rerender(); onChange && onChange(); });
  });
  openModal('Manage categories', body, [add]);
}

function catManageRow(name, onChanged) {
  const row = h('div', { class: 'manage-row cat-row' });
  function renderView() {
    row.innerHTML = '';
    const top = h('div', { class: 'manage-top' },
      h('div', { class: 'manage-info' }, h('div', { class: 'manage-name' }, h('span', null, name))));
    const actions = h('div', { class: 'manage-actions cat-row-actions' });
    const edit = h('button', { class: 'icon-btn', title: 'Rename' }, '✏️');
    edit.addEventListener('click', renderEdit);
    const del = h('button', { class: 'icon-btn danger', title: 'Delete' }, '🗑');
    del.addEventListener('click', () => {
      openConfirm('Delete category?',
        `"${name}" will be removed and unset from any habits using it. Habit history is preserved.`,
        'Delete', async () => {
          await deleteCustomCategory(name);
          closeModal();
          onChanged && onChanged();
        });
    });
    actions.append(edit, del);
    top.appendChild(actions);
    row.appendChild(top);
  }
  function renderEdit() {
    row.innerHTML = '';
    const input = h('input', { class: 'field', type: 'text', value: name, maxlength: '24' });
    const top = h('div', { class: 'manage-top' }, h('div', { class: 'manage-info' }, input));
    setTimeout(() => { input.focus(); input.select(); }, 50);
    const save = async () => {
      const n = input.value.trim();
      if (!n) return;
      if (n.toLowerCase() === name.toLowerCase()) { renderView(); return; }
      const ok = await renameCustomCategory(name, n);
      if (!ok) { toast('"' + n + '" already exists'); return; }
      onChanged && onChanged();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') renderView(); });
    const actions = h('div', { class: 'manage-actions cat-row-actions' });
    const saveBtn = h('button', { class: 'icon-btn', title: 'Save' }, '✓');
    saveBtn.addEventListener('click', save);
    const cancelBtn = h('button', { class: 'icon-btn', title: 'Cancel' }, '✕');
    cancelBtn.addEventListener('click', renderView);
    actions.append(saveBtn, cancelBtn);
    top.appendChild(actions);
    row.appendChild(top);
  }
  renderView();
  return row;
}

function openConfirm(title, msg, confirmLabel, onConfirm) {
  const body = h('div', { class: 'confirm' }, h('p', null, msg));
  const ok = h('button', { class: 'btn danger wide' }, confirmLabel);
  ok.addEventListener('click', onConfirm);
  const cancel = h('button', { class: 'btn wide' }, 'Cancel');
  cancel.addEventListener('click', closeModal);
  openModal(title, body, [ok, cancel]);
}

// ---------------------------------------------------------------------------
// Reminders / notifications
// ---------------------------------------------------------------------------
async function enableNotifications() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') { toast('Notifications are blocked in browser settings'); return false; }
  const p = await Notification.requestPermission();
  return p === 'granted';
}

async function notify(title, body, tag, habitId, extra) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // Foreground audible cue — browsers usually suppress the OS notification
  // sound when the posting page is focused, so we ring our own chime here.
  if (document.visibilityState === 'visible') playChime();
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const actions = habitId ? [
      { action: 'done', title: '✓ Done' },
      { action: 'snooze', title: '+30m' },
    ] : [];
    const opts = {
      body, tag, icon: './icons/icon-192.png', badge: './icons/favicon.png',
      data: Object.assign({ view: 'today', habitId }, extra || {}),
      actions,
      requireInteraction: !!habitId || (extra && extra.kind === 'wrapup'),
      renotify: true,
      silent: false,
      vibrate: [180, 80, 180, 80, 220],
    };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch (e) {}
}

function clearReminderTimers() {
  state.reminderTimers.forEach((t) => clearTimeout(t));
  state.reminderTimers = [];
  if (state.wrapupTimer) { clearTimeout(state.wrapupTimer); state.wrapupTimer = null; }
}

// Best-effort scheduling: in-app timers for today (work while open) plus
// scheduled triggers for the next days where the platform supports them.
function scheduleReminders() {
  clearReminderTimers();
  // Per-habit reminders and the Wrap-up each have their own enable toggle —
  // no master switch any more (it used to silently disable everything).
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const today = M.todayStr();

  // Per-habit reminders
  for (const habit of activeHabits()) {
    if (!(habit.reminder && habit.reminder.enabled && habit.reminder.time)) continue;
    if (!M.isScheduled(habit, today)) continue;
    if (M.isPausedOn(habit, today)) continue;

    const [hh, mm] = habit.reminder.time.split(':').map(Number);
    const baseFire = new Date(); baseFire.setHours(hh, mm, 0, 0);

    // initial reminder (skip if already done)
    if (baseFire > now) {
      const ms = baseFire - now;
      if (ms < 2 ** 31) {
        state.reminderTimers.push(setTimeout(() => {
          const l = getLog(habit.id, today);
          if (!(l && l.status === 'done')) notify(`${habit.icon || '✅'} ${habit.name}`, "It's time — log it in one tap.", 'rem-' + habit.id, habit.id);
        }, ms));
      }
    }

    // in-app repeats while open, capped at 3, stop at 22:00
    const repeatEvery = +habit.repeatEvery || 0;
    if (repeatEvery > 0) {
      for (let i = 1; i <= 3; i++) {
        const fire = new Date(baseFire.getTime() + repeatEvery * 60 * 1000 * i);
        if (fire.getHours() >= 22) break;
        if (fire <= now) continue;
        const ms = fire - now;
        if (ms >= 2 ** 31) continue;
        state.reminderTimers.push(setTimeout(() => {
          const l = getLog(habit.id, today);
          if (l && l.status === 'done') return;
          notify(`${habit.icon || '✅'} ${habit.name}`, 'Still pending — tap "Done" to log it.', 'rem-rpt-' + habit.id + '-' + i, habit.id);
        }, ms));
      }
    }

    // background scheduled triggers (where supported)
    scheduleTriggered(habit).catch(() => {});
  }

  // Daily Wrap-up scheduling — in-app timer for today + background triggers
  // for the next 7 days (where the browser supports notification triggers).
  scheduleWrapup();
  scheduleWrapupTriggered().catch(() => {});
}

function scheduleWrapup() {
  const wu = state.settings.wrapUp;
  if (!wu || !wu.enabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const [hh, mm] = (wu.time || DEFAULT_WRAPUP_TIME).split(':').map(Number);
  const fire = new Date(); fire.setHours(hh, mm, 0, 0);
  const now = new Date();
  if (fire <= now) return;
  const ms = fire - now;
  if (ms >= 2 ** 31) return;
  state.wrapupTimer = setTimeout(() => {
    const today = M.todayStr();
    // Skip the notification entirely if there's nothing to reflect on (all done & wrap-up already done).
    const pending = activeHabits()
      .filter((x) => M.isScheduled(x, today) && !M.isPausedOn(x, today))
      .filter((x) => { const l = getLog(x.id, today); return !(l && l.status === 'done'); });
    if (!pending.length && isWrapupDone(today)) return;
    const name = state.settings.userName ? ', ' + state.settings.userName : '';
    const body = pending.length
      ? `${pending.length} pending — tell me why so I can help.`
      : `Take a moment to wrap up.`;
    // Tag + data.kind let the SW deep-link to the wrap-up sheet on click.
    notify(`How did today go${name}?`, body, 'wrapup', null, { kind: 'wrapup' });
  }, ms);
}

// ---------------------------------------------------------------------------
// Daily Wrap-up sheet
// ---------------------------------------------------------------------------
function openWrapup(date = M.todayStr()) {
  const due = activeHabits().filter((x) => M.isScheduled(x, date) && !M.isPausedOn(x, date));
  const done = due.filter((x) => { const l = getLog(x.id, date); return l && l.status === 'done'; });
  const missed = due.filter((x) => !done.includes(x));
  // Carry pre-existing missed-reason answers (so re-opening doesn't wipe them)
  const reasons = new Map();      // habitId -> reasonKey
  const notesOf = new Map();      // habitId -> note string
  for (const h of missed) {
    const log = getLog(h.id, date);
    if (log && log.status === 'missed') {
      if (log.reason) reasons.set(h.id, log.reason);
      if (log.note) notesOf.set(h.id, log.note);
    }
  }

  const greetName = state.settings.userName ? `, ${state.settings.userName}` : '';
  const body = h('div', { class: 'wrapup' });

  // Header banner — celebration or reflection
  if (!due.length) {
    body.appendChild(h('p', { class: 'wrap-intro' },
      `No habits scheduled today${greetName}. Tap finish to record the wrap-up.`));
  } else if (!missed.length) {
    body.appendChild(h('p', { class: 'wrap-intro celebrate' },
      `🌿 All done today${greetName} — nicely held. Anything to remember?`));
  } else {
    body.appendChild(h('p', { class: 'wrap-intro' },
      `Quick reflection${greetName}: tap a reason for anything you missed today. No judgment — just data so the app can spot patterns later.`));
  }

  // Done summary (collapsed)
  if (done.length) {
    const block = h('div', { class: 'wrap-done-block' });
    block.appendChild(h('div', { class: 'group-label' }, `✓ Done (${done.length})`));
    const list = h('div', { class: 'wrap-done-list' });
    for (const ht of done) {
      list.appendChild(h('div', { class: 'wrap-done-row' },
        h('span', { class: 'hicon sm', style: { background: tint(ht.color), color: ht.color } }, ht.icon || '✅'),
        h('span', { class: 'wrap-done-name' }, ht.name)));
    }
    block.appendChild(list);
    body.appendChild(block);
  }

  // Missed reasons — autosave on every tap/change so dismissing the sheet
  // never loses data the user already entered.
  async function syncMissed(habitId) {
    const reason = reasons.get(habitId);
    const note = notesOf.get(habitId) || '';
    const id = `${habitId}|${date}`;
    if (!reason && !note) {
      await db.delete('logs', id);
      const arr = state.logsByHabit.get(habitId) || [];
      state.logsByHabit.set(habitId, arr.filter((l) => l.id !== id));
    } else {
      await setMissed(habitId, date, reason || '', note);
    }
  }

  if (missed.length) {
    body.appendChild(h('div', { class: 'group-label' }, `Why missed? (${missed.length})`));
    for (const ht of missed) {
      const card = h('div', { class: 'wrap-miss-card' });
      card.appendChild(h('div', { class: 'wrap-miss-head' },
        h('span', { class: 'hicon sm', style: { background: tint(ht.color), color: ht.color } }, ht.icon || '✅'),
        h('span', { class: 'wrap-miss-name' }, ht.name)));
      const chips = h('div', { class: 'reason-row' });
      for (const r of M.MISS_REASONS) {
        const chip = h('button', {
          class: 'reason-chip' + (reasons.get(ht.id) === r.key ? ' on' : ''),
          dataset: { reason: r.key },
        }, h('span', { class: 'reason-emoji' }, r.emoji), h('span', { class: 'reason-label' }, r.label));
        chip.addEventListener('click', async () => {
          if (reasons.get(ht.id) === r.key) reasons.delete(ht.id);
          else reasons.set(ht.id, r.key);
          chips.querySelectorAll('.reason-chip').forEach((c) =>
            c.classList.toggle('on', c.dataset.reason === reasons.get(ht.id)));
          await syncMissed(ht.id);   // autosave
        });
        chips.appendChild(chip);
      }
      card.appendChild(chips);
      if (ht.notesEnabled !== false) {
        const note = h('input', { class: 'field', type: 'text', placeholder: 'Optional note', maxlength: '80', value: notesOf.get(ht.id) || '' });
        note.addEventListener('change', async () => {
          notesOf.set(ht.id, note.value.trim());
          await syncMissed(ht.id);   // autosave
        });
        card.appendChild(note);
      }
      body.appendChild(card);
    }
  }

  const finish = h('button', { class: 'btn btn-primary wide' }, 'Finish wrap-up');
  finish.addEventListener('click', async () => {
    // Reasons were autosaved as the user tapped — Finish only marks the
    // wrap-up itself complete (which feeds the Consistency streak).
    await setWrapupDone(date);
    closeModal();
    toast('Wrap-up saved — Consistency streak preserved');
    render();
  });

  openModal(`Daily Wrap-up`, body, [finish]);
}

// ---------------------------------------------------------------------------
// Fingerprint / WebAuthn (platform authenticator only — no remote server)
// ---------------------------------------------------------------------------
function _bufToHex(b) {
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}
function _hexToBuf(hex) {
  const m = hex.match(/.{2}/g) || [];
  return new Uint8Array(m.map((x) => parseInt(x, 16)));
}

// Background-scheduled wrap-up notifications for the next 7 days. Survives
// the app being closed (on browsers that implement Notification Triggers —
// Chrome on Android primarily; on Safari/Firefox this is a no-op and we
// rely on the in-app setTimeout instead).
async function scheduleWrapupTriggered() {
  if (!('Notification' in window) || !('showTrigger' in Notification.prototype)) return;
  if (typeof TimestampTrigger === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  const wu = state.settings.wrapUp;
  if (!wu || !wu.enabled) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const [hh, mm] = (wu.time || DEFAULT_WRAPUP_TIME).split(':').map(Number);
  // Clear stale wrap-up triggers we previously registered, then re-add for
  // the next 7 days. Notifications carrying our 'wrapup-' tag prefix are ours.
  try {
    const existing = await reg.getNotifications({ includeTriggered: true });
    for (const n of existing) if (n.tag && n.tag.startsWith('wrapup-')) n.close();
  } catch (_) {}
  const nameSuffix = state.settings.userName ? ', ' + state.settings.userName : '';
  const todayD = new Date();
  for (let d = 0; d < 7; d++) {
    const day = new Date(todayD); day.setDate(todayD.getDate() + d);
    const fire = new Date(day); fire.setHours(hh, mm, 0, 0);
    if (fire <= new Date()) continue;
    const ds = M.ymd(day);
    if (d === 0 && isWrapupDone(ds)) continue; // already done — skip today's
    try {
      await reg.showNotification(`How did today go${nameSuffix}?`, {
        body: 'Take a moment to wrap up.',
        tag: `wrapup-${ds}`,
        icon: './icons/icon-192.png', badge: './icons/favicon.png',
        requireInteraction: true,
        silent: false,
        vibrate: [180, 80, 180, 80, 220],
        showTrigger: new TimestampTrigger(fire.getTime()),
        data: { view: 'today', kind: 'wrapup' },
      });
    } catch (e) { break; }
  }
}

async function scheduleTriggered(habit) {
  if (!('Notification' in window) || !('showTrigger' in Notification.prototype)) return;
  if (typeof TimestampTrigger === 'undefined') return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const [hh, mm] = habit.reminder.time.split(':').map(Number);
  for (let d = 0; d < 7; d++) {
    const day = M.addDays(new Date(), d);
    const ds = M.ymd(day);
    if (!M.isScheduled(habit, ds) || M.isPausedOn(habit, ds)) continue;
    const fire = new Date(day); fire.setHours(hh, mm, 0, 0);
    if (fire <= new Date()) continue;
    try {
      await reg.showNotification(`${habit.icon || '✅'} ${habit.name}`, {
        body: "It's time — log it in one tap.",
        tag: `rem-${habit.id}-${ds}`, icon: './icons/icon-192.png', badge: './icons/favicon.png',
        actions: [{ action: 'done', title: '✓ Done' }, { action: 'snooze', title: '+30m' }],
        requireInteraction: true,
        silent: false,
        vibrate: [180, 80, 180, 80, 220],
        showTrigger: new TimestampTrigger(fire.getTime()),
        data: { view: 'today', habitId: habit.id },
      });
    } catch (e) { break; }
  }
}

// ---------------------------------------------------------------------------
// PIN lock
// ---------------------------------------------------------------------------
function buildPinPad(onDigit, onDelete) {
  const pad = $('#pin-pad'); pad.innerHTML = '';
  ['1','2','3','4','5','6','7','8','9','','0','⌫'].forEach((k) => {
    if (k === '') { pad.appendChild(h('div')); return; }
    const b = h('button', { class: 'pin-key' }, k);
    b.addEventListener('click', () => { haptic(5); k === '⌫' ? onDelete() : onDigit(k); });
    pad.appendChild(b);
  });
}
function setPinDots(n) {
  const dots = $('#pin-dots'); dots.innerHTML = '';
  for (let i = 0; i < 4; i++) dots.appendChild(h('span', { class: 'pin-dot' + (i < n ? ' on' : '') }));
}

function showLock() {
  const lock = $('#lock');
  lock.classList.remove('hidden'); lock.setAttribute('aria-hidden', 'false');
  $('#lock-error').textContent = '';
  // Personalised greeting
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Welcome back';
  const nm = state.settings.userName;
  $('#lock-greeting').textContent = nm ? `${part}, ${nm}` : 'Welcome back';
  $('#lock-sub').textContent = 'Enter your PIN to continue';
  let entry = '';
  setPinDots(0);
  buildPinPad(async (d) => {
    if (entry.length >= 4) return;
    entry += d; setPinDots(entry.length);
    if (entry.length === 4) {
      const ok = (await sha256(entry)) === state.settings.pinHash;
      if (ok) closeLock();
      else {
        $('#lock-error').textContent = 'Wrong PIN';
        $('.lock-inner').classList.add('shake');
        setTimeout(() => { $('.lock-inner').classList.remove('shake'); entry = ''; setPinDots(0); }, 450);
      }
    }
  }, () => { entry = entry.slice(0, -1); setPinDots(entry.length); });
}

function closeLock() {
  const lock = $('#lock');
  lock.classList.add('unlock-anim');
  setTimeout(() => {
    lock.classList.add('hidden');
    lock.classList.remove('unlock-anim');
    lock.setAttribute('aria-hidden', 'true');
  }, 280);
}

function setPinFlow() {
  let first = '', entry = '', stage = 1;
  const dots = h('div', { class: 'pin-dots' });
  const pad = h('div', { class: 'pin-pad' });
  const title = h('div', { class: 'day-panel-title' }, 'Enter a new 4-digit PIN');
  const err = h('p', { class: 'lock-error' });
  function paint() { dots.innerHTML = ''; for (let i = 0; i < 4; i++) dots.appendChild(h('span', { class: 'pin-dot' + (i < entry.length ? ' on' : '') })); }
  function build() {
    pad.innerHTML = '';
    ['1','2','3','4','5','6','7','8','9','','0','⌫'].forEach((k) => {
      if (k === '') { pad.appendChild(h('div')); return; }
      const b = h('button', { class: 'pin-key' }, k);
      b.addEventListener('click', async () => {
        haptic(5);
        if (k === '⌫') { entry = entry.slice(0, -1); paint(); return; }
        if (entry.length >= 4) return;
        entry += k; paint();
        if (entry.length === 4) {
          if (stage === 1) { first = entry; entry = ''; stage = 2; title.textContent = 'Confirm your PIN'; paint(); }
          else {
            if (entry === first) {
              state.settings.pinHash = await sha256(first);
              await setSetting('pinHash', state.settings.pinHash);
              closeModal(); toast('PIN set'); renderSettings();
            } else { err.textContent = "PINs didn't match — start again"; first = ''; entry = ''; stage = 1; title.textContent = 'Enter a new 4-digit PIN'; paint(); }
          }
        }
      });
      pad.appendChild(b);
    });
  }
  paint(); build();
  openModal('Set PIN', h('div', { class: 'pin-setup' }, title, dots, pad, err));
}

function changePinFlow() {
  const remove = h('button', { class: 'btn danger wide' }, 'Remove PIN');
  remove.addEventListener('click', async () => {
    state.settings.pinHash = null;
    await setSetting('pinHash', null);
    closeModal();
    toast('PIN removed');
    renderSettings();
  });
  const change = h('button', { class: 'btn btn-primary wide' }, 'Set a new PIN');
  change.addEventListener('click', () => { closeModal(); setPinFlow(); });
  openModal('App lock', h('div', { class: 'confirm' }, h('p', null, 'A PIN is currently set. You can change it or remove it.')), [change, remove]);
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme() {
  const t = state.settings.theme || 'auto';
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--accent', state.settings.accent);
  applyThemeColorMeta();
}
function applyThemeColorMeta() {
  const meta = $('#theme-color-meta');
  if (meta) meta.setAttribute('content', state.settings.accent || '#10b981');
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------
function tint(hex) { return (hex || '#10b981') + '22'; }
function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function freqLabel(habit) {
  const f = habit.frequency || { type: 'daily' };
  if (f.type === 'daily') return 'Every day';
  if (f.type === 'weekly') return `${f.weeklyTarget || 1}× per week`;
  if (f.type === 'custom') {
    const days = (f.days || []).map((d) => M.WEEKDAY_LABELS[d].slice(0, 2)).join(' ');
    return days || 'Custom';
  }
  return '';
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function boot() {
  await loadAll();
  applyTheme();

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.settings.theme === 'auto') applyTheme(); });

  // Disable pull-to-refresh by preventing touchmove at the top of the page
  let touchStartY = 0;
  document.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, false);
  document.addEventListener('touchmove', (e) => {
    if (document.documentElement.scrollTop === 0 && e.touches[0].clientY > touchStartY) {
      e.preventDefault();
    }
  }, { passive: false });

  // Lock only on cold app start (first load), not on pull-refresh or warm return from background.
  // Once the app has booted once this session, appWasRunning stays true for the lifetime.
  if (!state.appWasRunning && state.settings.pinHash) showLock();

  // Honor URL params (notification actions, install shortcuts)
  const params = new URLSearchParams(location.search);
  // The Wrap-up notification has tag='wrapup' — clicking it opens this view.
  // We can't read the tag from the URL alone, so open the wrap-up if the
  // tab regains focus AFTER wrap-up time and there's pending reflection.
  if (params.get('action') === 'wrapup') openWrapup();

  if (params.get('habit') && params.get('action') === 'done') {
    const id = params.get('habit');
    const habit = state.habits.find((x) => x.id === id);
    if (habit) {
      const today = M.todayStr();
      const log = getLog(habit.id, today);
      if (!(log && log.status === 'done')) { await setLog(habit.id, today, 'done'); toast(`Marked “${habit.name}” done`); }
    }
    history.replaceState({}, '', './');
  }

  const start = params.get('view') || 'today';
  setView(['today', 'tracker', 'stats', 'insights', 'habits', 'settings'].includes(start) ? start : 'today');
  if (params.get('action') === 'add') openEditor();

  // First-run: no habits AND no name → full onboarding. After it closes, the
  // app keeps running normally.
  if (!state.habits.length && !state.settings.userName) {
    openOnboarding();
  } else if (!state.settings.userName) {
    // Existing user upgrading: ask for the name one time only (skippable).
    askNameOnce();
  }

  // Listen for SW messages (notification "Done" action posts mark-done)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (ev) => {
      if (!ev.data) return;
      if (ev.data.type === 'mark-done' && ev.data.habitId) {
        const habit = state.habits.find((x) => x.id === ev.data.habitId);
        if (!habit) return;
        const today = M.todayStr();
        const log = getLog(habit.id, today);
        if (!(log && log.status === 'done')) {
          await setLog(habit.id, today, 'done');
          toast(`Marked “${habit.name}” done`);
          if (state.view === 'today') render();
        }
      } else if (ev.data.type === 'open-wrapup') {
        openWrapup();
      }
    });
  }

  // Refresh "today" when tab regains focus (date may have changed)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'today') render(); });

  scheduleReminders();

  // Service worker registration — new versions install silently; user taps to activate.
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      window.__swReg = reg;
      // Detect if an update is already waiting (e.g., from a background update check before app open)
      if (reg.waiting && navigator.serviceWorker.controller) {
        window.__updateReady = true;
        render(); // refresh the settings menu if it's open
      }
      // Listen for future updates discovered after app open
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            window.__updateReady = true;
            render();
          }
        });
      });
    } catch (e) {}
  }
  // When user triggers skip-wait, page reloads via this handler (only once per session)
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  // Mark that the app has booted — no more lock screens until the next cold start.
  state.appWasRunning = true;
}

boot();
