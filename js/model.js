// model.js — pure domain logic. No DOM, no storage. Easy to reason about & test.
// Handles: local-date math, frequency rules, pause-aware streaks, lightweight
// stats and a small data-driven insight engine.

// ---------------------------------------------------------------------------
// Date helpers (LOCAL time — so "today" matches the user's wall clock, never UTC)
// ---------------------------------------------------------------------------
export function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function todayStr() { return ymd(new Date()); }
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
export function weekday(dateOrStr) {
  const d = typeof dateOrStr === 'string' ? parseYmd(dateOrStr) : dateOrStr;
  return d.getDay(); // 0 = Sun .. 6 = Sat
}
export function weekKey(dateOrStr) {
  const d = typeof dateOrStr === 'string' ? parseYmd(dateOrStr) : new Date(dateOrStr);
  const t = new Date(d);
  const day = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - day);
  return ymd(t);
}
export function startOfWeek(dateOrStr) {
  const d = typeof dateOrStr === 'string' ? parseYmd(dateOrStr) : new Date(dateOrStr);
  const day = (d.getDay() + 6) % 7;
  return addDays(d, -day);
}
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ---------------------------------------------------------------------------
// Frequency + pause
// ---------------------------------------------------------------------------
// frequency = { type:'daily' } | { type:'custom', days:[0..6] } | { type:'weekly', weeklyTarget:n }
// pauseHistory = [{ from:'YYYY-MM-DD', to:'YYYY-MM-DD'|null }]  (to = resume date, exclusive)

export function isScheduled(habit, dateStr) {
  const f = habit.frequency || { type: 'daily' };
  if (f.type === 'daily') return true;
  if (f.type === 'weekly') return true;
  if (f.type === 'custom') return (f.days || []).includes(weekday(dateStr));
  return true;
}

export function isPausedOn(habit, dateStr) {
  const hist = habit.pauseHistory || [];
  for (const r of hist) {
    if (!r || !r.from) continue;
    if (dateStr >= r.from && (r.to == null || dateStr < r.to)) return true;
  }
  return false;
}

export function logMap(logs) {
  const m = new Map();
  for (const l of logs) m.set(l.date, l);
  return m;
}

// ---------------------------------------------------------------------------
// Streaks (pause ranges count as neutral — they don't break the streak)
// ---------------------------------------------------------------------------
export function currentStreak(habit, lmap, today = todayStr()) {
  const f = habit.frequency || { type: 'daily' };
  if (f.type === 'weekly') return currentWeeklyStreak(habit, lmap, today);
  let streak = 0;
  let cursor = parseYmd(today);
  const todayLog = lmap.get(today);
  if (isScheduled(habit, today) && (!todayLog || todayLog.status === 'pending')) {
    cursor = addDays(cursor, -1);
  }
  for (let i = 0; i < 3700; i++) {
    const ds = ymd(cursor);
    if (isScheduled(habit, ds)) {
      const log = lmap.get(ds);
      if (log && log.status === 'done') streak++;
      else if (log && log.status === 'skipped') { /* neutral */ }
      else if (isPausedOn(habit, ds)) { /* neutral — habit was paused */ }
      else break; // missed scheduled day
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function currentWeeklyStreak(habit, lmap, today) {
  const target = (habit.frequency && habit.frequency.weeklyTarget) || 1;
  const byWeek = new Map();
  for (const [date, log] of lmap) {
    if (log.status === 'done') {
      const k = weekKey(date);
      byWeek.set(k, (byWeek.get(k) || 0) + 1);
    }
  }
  let streak = 0;
  let cursor = startOfWeek(today);
  const thisWeek = weekKey(today);
  if ((byWeek.get(thisWeek) || 0) < target) cursor = addDays(cursor, -7);
  for (let i = 0; i < 520; i++) {
    const k = weekKey(cursor);
    if ((byWeek.get(k) || 0) >= target) streak++;
    else break;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

export function bestStreak(habit, lmap) {
  const f = habit.frequency || { type: 'daily' };
  if (f.type === 'weekly') {
    const target = f.weeklyTarget || 1;
    const byWeek = new Map();
    for (const [date, log] of lmap) {
      if (log.status === 'done') {
        const k = weekKey(date);
        byWeek.set(k, (byWeek.get(k) || 0) + 1);
      }
    }
    const weeks = [...byWeek.keys()].sort();
    let best = 0, run = 0, prev = null;
    for (const wk of weeks) {
      if ((byWeek.get(wk) || 0) < target) continue;
      if (prev && weekKey(addDays(parseYmd(prev), 7)) === wk) run++;
      else run = 1;
      prev = wk;
      best = Math.max(best, run);
    }
    return best;
  }
  const dates = [...lmap.keys()].sort();
  if (!dates.length) return 0;
  let best = 0, run = 0;
  let cursor = parseYmd(dates[0]);
  const end = parseYmd(todayStr());
  while (cursor <= end) {
    const ds = ymd(cursor);
    if (isScheduled(habit, ds)) {
      const log = lmap.get(ds);
      if (log && log.status === 'done') { run++; best = Math.max(best, run); }
      else if (log && log.status === 'skipped') { /* neutral */ }
      else if (isPausedOn(habit, ds)) { /* neutral */ }
      else run = 0;
    }
    cursor = addDays(cursor, 1);
  }
  return best;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
function createdDayOf(habit) {
  return habit.createdAt ? ymd(new Date(habit.createdAt)) : '2000-01-01';
}

// Counts only SCHEDULED, NON-PAUSED days. Stops at the habit's creation day.
export function lastNStats(habit, logs, n, today = todayStr()) {
  const lmap = logMap(logs);
  const createdDay = createdDayOf(habit);
  let sched = 0, done = 0;
  let cursor = parseYmd(today);
  for (let i = 0; i < n; ) {
    const ds = ymd(cursor);
    if (isScheduled(habit, ds) && !isPausedOn(habit, ds)) {
      i++;
      sched++;
      const log = lmap.get(ds);
      if (log && log.status === 'done') done++;
    } else {
      // skip days that don't count toward the window (paused or not scheduled)
      i++;
    }
    cursor = addDays(cursor, -1);
    if (cursor < parseYmd(createdDay)) break;
  }
  return { done, sched, pct: sched ? Math.round((done / sched) * 100) : 0 };
}

export function habitStats(habit, logs, today = todayStr()) {
  const lmap = logMap(logs);
  const cur = currentStreak(habit, lmap, today);
  const best = Math.max(cur, bestStreak(habit, lmap));

  const createdDay = createdDayOf(habit);
  let sched30 = 0, done30 = 0;
  let cursor = parseYmd(today);
  for (let i = 0; i < 30; ) {
    const ds = ymd(cursor);
    if (isScheduled(habit, ds) && !isPausedOn(habit, ds)) {
      i++;
      sched30++;
      const log = lmap.get(ds);
      if (log && log.status === 'done') done30++;
    }
    cursor = addDays(cursor, -1);
    if (cursor < parseYmd(createdDay)) break;
  }
  const completion30 = sched30 ? Math.round((done30 / sched30) * 100) : 0;

  const wk = weekKey(today);
  let weekDone = 0;
  for (const [date, log] of lmap) {
    if (log.status === 'done' && weekKey(date) === wk) weekDone++;
  }
  const weekTarget = habit.frequency && habit.frequency.type === 'weekly'
    ? (habit.frequency.weeklyTarget || 1)
    : countScheduledThisWeek(habit, today);

  let totalDone = 0;
  for (const l of logs) if (l.status === 'done') totalDone++;

  return { cur, best, completion30, weekDone, weekTarget, totalDone };
}

function countScheduledThisWeek(habit, today) {
  const start = startOfWeek(today);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const ds = ymd(addDays(start, i));
    if (isScheduled(habit, ds) && !isPausedOn(habit, ds)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Global consistency (across all active habits)
// ---------------------------------------------------------------------------
// Returns {done, sched, pct} aggregated over the given date range (inclusive).
export function rangeCompletion(habits, logsByHabit, fromStr, toStr) {
  let sched = 0, done = 0;
  let cursor = parseYmd(fromStr);
  const end = parseYmd(toStr);
  while (cursor <= end) {
    const ds = ymd(cursor);
    for (const h of habits) {
      if (!isScheduled(h, ds)) continue;
      if (isPausedOn(h, ds)) continue;
      const createdDay = createdDayOf(h);
      if (ds < createdDay) continue;
      sched++;
      const log = (logsByHabit.get ? logsByHabit.get(h.id) : logsByHabit[h.id]) || [];
      if (log.find((l) => l.date === ds && l.status === 'done')) done++;
    }
    cursor = addDays(cursor, 1);
  }
  return { done, sched, pct: sched ? Math.round((done / sched) * 100) : 0 };
}

export function thisWeekCompletion(habits, logsByHabit, today = todayStr()) {
  const start = ymd(startOfWeek(today));
  return rangeCompletion(habits, logsByHabit, start, today);
}
export function prevWeekCompletion(habits, logsByHabit, today = todayStr()) {
  const start = ymd(addDays(startOfWeek(today), -7));
  const end = ymd(addDays(parseYmd(start), 6));
  return rangeCompletion(habits, logsByHabit, start, end);
}
export function thisMonthCompletion(habits, logsByHabit, today = todayStr()) {
  const t = parseYmd(today);
  const start = ymd(new Date(t.getFullYear(), t.getMonth(), 1));
  return rangeCompletion(habits, logsByHabit, start, today);
}

// Context for the Today motivational quote:
//   • tier     — yesterday's completion tone:
//       'fresh'   = nothing was scheduled (rest day / brand-new) — never a guilt nudge
//       'none'    = scheduled but 0 done
//       'partial' = some done (1–99%)
//       'allDone' = everything scheduled was done
//   • category — the most-scheduled category among yesterday's (non-paused) habits,
//                'General' when there's no clear winner.
export function yesterdayQuoteContext(habits, logsByHabit, today = todayStr()) {
  const y = ymd(addDays(parseYmd(today), -1));
  const { sched, done } = rangeCompletion(habits, logsByHabit, y, y);
  let tier;
  if (sched === 0) tier = 'fresh';
  else if (done === 0) tier = 'none';
  else if (done >= sched) tier = 'allDone';
  else tier = 'partial';

  // Dominant category among habits scheduled (and not paused) yesterday.
  const counts = new Map();
  for (const h of habits) {
    if (!isScheduled(h, y) || isPausedOn(h, y)) continue;
    if (y < createdDayOf(h)) continue;
    const cats = (h.categories && h.categories.length) ? h.categories
      : (h.category ? [h.category] : []);
    for (const c of cats) counts.set(c, (counts.get(c) || 0) + 1);
  }
  let category = 'General', max = 0;
  for (const [c, n] of counts) if (n > max) { max = n; category = c; }
  return { tier, category };
}

// ---------------------------------------------------------------------------
// Recent strip — flat array of the last N days (newest LAST), used by the
// scrollable single-line heatmap. Today is the last element.
// ---------------------------------------------------------------------------
export function recentHeatmap(habit, logs, days = 30, today = todayStr()) {
  const lmap = logMap(logs);
  const cells = [];
  const todayD = parseYmd(today);
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(todayD, -i);
    const ds = ymd(d);
    const log = lmap.get(ds);
    cells.push({
      date: ds,
      day: d.getDate(),
      dow: d.getDay(),
      monthStart: d.getDate() === 1,
      scheduled: isScheduled(habit, ds),
      paused: isPausedOn(habit, ds),
      status: log ? log.status : null,
      reason: log ? log.reason : null,
      ts: log ? log.ts : null,                  // ms timestamp of when written
      note: (log && log.note && log.note.trim()) ? log.note : null,  // recorded note (if any)
      isToday: ds === today,
    });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Heatmap grid (legacy week-aligned layout — kept for any future overview UI)
// ---------------------------------------------------------------------------
export function heatmapData(habit, logs, weeks = 18, today = todayStr()) {
  const lmap = logMap(logs);
  const cells = [];
  const totalDays = weeks * 7;
  const end = parseYmd(today);
  const start = startOfWeek(addDays(end, -(totalDays - 1)));
  let cursor = new Date(start);
  while (cursor <= end) {
    const ds = ymd(cursor);
    const log = lmap.get(ds);
    cells.push({
      date: ds,
      scheduled: isScheduled(habit, ds),
      paused: isPausedOn(habit, ds),
      status: log ? log.status : null,
      future: cursor > end,
    });
    cursor = addDays(cursor, 1);
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Wrap-up reasons + Consistency streak
// ---------------------------------------------------------------------------
export const WRAPUP_HABIT_ID = '__wrapup__';

// Predefined miss reasons — fixed set, NOT user-editable.
export const MISS_REASONS = [
  { key: 'no_time',   emoji: '⏱',   label: 'No time' },
  { key: 'tired',     emoji: '😴',  label: 'Too tired' },
  { key: 'unwell',    emoji: '🤒',  label: 'Unwell' },
  { key: 'forgot',    emoji: '🤔',  label: 'Forgot' },
  { key: 'mood',      emoji: '😶‍🌫️', label: 'Not in mood' },
  { key: 'travel',    emoji: '✈️',  label: 'Travel / plans' },
  { key: 'not_today', emoji: '🧭',  label: 'Not right today' },
];
export function reasonLabel(key) { const r = MISS_REASONS.find((x) => x.key === key); return r ? r.label : key; }
export function reasonEmoji(key) { const r = MISS_REASONS.find((x) => x.key === key); return r ? r.emoji : '•'; }

function wrapupDone(logsByHabit, dateStr) {
  const arr = (logsByHabit.get ? logsByHabit.get(WRAPUP_HABIT_ID) : logsByHabit[WRAPUP_HABIT_ID]) || [];
  return arr.some((l) => l.date === dateStr && l.status === 'done');
}
function anyHabitDone(habits, logsByHabit, dateStr) {
  for (const h of habits) {
    const arr = (logsByHabit.get ? logsByHabit.get(h.id) : logsByHabit[h.id]) || [];
    if (arr.some((l) => l.date === dateStr && l.status === 'done')) return true;
  }
  return false;
}
export function isEngagedDay(habits, logsByHabit, dateStr) {
  return anyHabitDone(habits, logsByHabit, dateStr) || wrapupDone(logsByHabit, dateStr);
}

// App-wide engagement streak: any habit done OR wrap-up completed each day.
export function consistencyStreak(habits, logsByHabit, today = todayStr()) {
  let streak = 0;
  let cursor = parseYmd(today);
  if (!isEngagedDay(habits, logsByHabit, today)) cursor = addDays(cursor, -1);
  for (let i = 0; i < 3700; i++) {
    if (!isEngagedDay(habits, logsByHabit, ymd(cursor))) break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function bestConsistencyStreak(habits, logsByHabit, today = todayStr()) {
  const earliest = earliestEngagementDate(habits, logsByHabit);
  if (!earliest) return 0;
  let best = 0, run = 0;
  let cursor = parseYmd(earliest);
  const end = parseYmd(today);
  while (cursor <= end) {
    if (isEngagedDay(habits, logsByHabit, ymd(cursor))) { run++; best = Math.max(best, run); } else run = 0;
    cursor = addDays(cursor, 1);
  }
  return best;
}
function earliestEngagementDate(habits, logsByHabit) {
  let earliest = null;
  const consider = (d) => { if (!earliest || d < earliest) earliest = d; };
  for (const h of habits) {
    const arr = (logsByHabit.get ? logsByHabit.get(h.id) : logsByHabit[h.id]) || [];
    for (const l of arr) if (l.status === 'done') consider(l.date);
  }
  const wraps = (logsByHabit.get ? logsByHabit.get(WRAPUP_HABIT_ID) : logsByHabit[WRAPUP_HABIT_ID]) || [];
  for (const l of wraps) if (l.status === 'done') consider(l.date);
  return earliest;
}

// Aggregate miss reasons across all habits over the last N days.
export function reasonBreakdown(habits, logsByHabit, days = 30, today = todayStr()) {
  const cutoff = ymd(addDays(parseYmd(today), -(days - 1)));
  const totals = new Map(MISS_REASONS.map((r) => [r.key, 0]));
  let total = 0;
  for (const h of habits) {
    const arr = (logsByHabit.get ? logsByHabit.get(h.id) : logsByHabit[h.id]) || [];
    for (const l of arr) {
      if (l.status !== 'missed' || !l.reason) continue;
      if (l.date < cutoff) continue;
      totals.set(l.reason, (totals.get(l.reason) || 0) + 1);
      total++;
    }
  }
  const rows = [...totals.entries()]
    .map(([key, count]) => ({ key, count, pct: total ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
  return { rows, total };
}

// Which weekday do you complete the most habits on? Works without any
// wrap-up data — needs only 'done' logs.
export function bestDayOfWeek(habits, logsByHabit) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const h of habits) {
    const arr = (logsByHabit.get ? logsByHabit.get(h.id) : logsByHabit[h.id]) || [];
    for (const l of arr) {
      if (l.status === 'done') counts[weekday(l.date)]++;
    }
  }
  let max = 0, idx = -1, total = 0;
  for (let i = 0; i < 7; i++) { total += counts[i]; if (counts[i] > max) { max = counts[i]; idx = i; } }
  return idx >= 0 ? { dayIdx: idx, dayLabel: WEEKDAY_LABELS[idx], count: max, total } : null;
}

// Top miss reason for a single habit (used for per-habit insights).
export function topReasonForHabit(habit, logs, days = 60, today = todayStr()) {
  const cutoff = ymd(addDays(parseYmd(today), -(days - 1)));
  const counts = new Map();
  let total = 0;
  for (const l of logs) {
    if (l.status !== 'missed' || !l.reason || l.date < cutoff) continue;
    counts.set(l.reason, (counts.get(l.reason) || 0) + 1);
    total++;
  }
  let bestKey = null, bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; bestKey = k; }
  return bestKey ? { key: bestKey, count: bestN, pct: Math.round((bestN / total) * 100) } : null;
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------
export const MILESTONES = [7, 21, 30, 50, 100, 150, 200, 365, 500, 1000];
export function reachedMilestone(prev, next) {
  return MILESTONES.find((m) => prev < m && next >= m) || null;
}

// ---------------------------------------------------------------------------
// Priority score (for the Today "Focus" section sort)
// ---------------------------------------------------------------------------
// Higher = should be tackled first. Honors: explicit pin, overdue reminder,
// matching time-of-day, then current streak length.
export function priorityScore(habit, stats, now = new Date()) {
  let s = 0;
  if (habit.priority) s += 100;
  const r = habit.reminder;
  if (r && r.enabled && r.time) {
    const [hh, mm] = r.time.split(':').map(Number);
    if (now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm)) s += 30;
  }
  const hr = now.getHours();
  const period = hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening';
  if (habit.routine === period) s += 10;
  s += Math.min(stats?.cur || 0, 50) * 0.1;
  return s;
}

// ---------------------------------------------------------------------------
// Insight engine — picks ONE short, data-driven encouragement message
// (returns null when nothing meaningful to say; avoids generic quotes)
// ---------------------------------------------------------------------------
export function pickInsight(habits, logsByHabit, today = todayStr()) {
  const active = habits.filter((h) => !h.paused && !h.archived);
  if (!active.length) return null;

  // 1) Personal best on an active streak
  for (const h of active) {
    const logs = logsByHabit.get(h.id) || [];
    const lm = logMap(logs);
    const cur = currentStreak(h, lm, today);
    const best = bestStreak(h, lm);
    if (cur > 0 && cur === best && cur >= 5) {
      return { emoji: '🏆', text: `New personal best: ${cur}-day streak on ${h.name}.` };
    }
  }

  // 2) Close-to-best ("3 days from your best on X")
  let nearest = null;
  for (const h of active) {
    const logs = logsByHabit.get(h.id) || [];
    const lm = logMap(logs);
    const cur = currentStreak(h, lm, today);
    const best = bestStreak(h, lm);
    const delta = best - cur;
    if (cur >= 3 && delta > 0 && delta <= 4) {
      if (!nearest || delta < nearest.delta) nearest = { habit: h, delta, cur, best };
    }
  }
  if (nearest) return { emoji: '🔥', text: `${nearest.delta} day${nearest.delta === 1 ? '' : 's'} from your best on ${nearest.habit.name}.` };

  // 3) Week-over-week improvement
  const thisW = thisWeekCompletion(active, logsByHabit, today);
  const prevW = prevWeekCompletion(active, logsByHabit, today);
  if (thisW.sched >= 3 && prevW.sched >= 3 && thisW.pct >= prevW.pct + 10) {
    return { emoji: '📈', text: `Up ${thisW.pct - prevW.pct}% versus last week.` };
  }
  if (thisW.sched >= 5 && thisW.pct >= 80) {
    return { emoji: '🌿', text: `You're ${thisW.pct}% consistent this week — keep going.` };
  }

  // 4) Today progress nudge
  const todayActive = active.filter((h) => isScheduled(h, today) && !isPausedOn(h, today));
  const todayDone = todayActive.filter((h) => {
    const log = (logsByHabit.get(h.id) || []).find((l) => l.date === today);
    return log && log.status === 'done';
  });
  if (todayActive.length && todayDone.length === todayActive.length) {
    return { emoji: '🎉', text: 'All habits done today. Take a moment to enjoy that.' };
  }
  if (todayActive.length >= 3 && todayDone.length > 0 && todayDone.length < todayActive.length) {
    return { emoji: '✨', text: `${todayDone.length} of ${todayActive.length} done — small wins add up.` };
  }

  // 5) Most consistent habit
  let bestHabit = null, bestPct = 0;
  for (const h of active) {
    const logs = logsByHabit.get(h.id) || [];
    const s = lastNStats(h, logs, 30, today);
    if (s.sched >= 5 && s.pct > bestPct) { bestPct = s.pct; bestHabit = h; }
  }
  if (bestHabit && bestPct >= 80) {
    return { emoji: '⭐', text: `Most consistent: ${bestHabit.name} (${bestPct}% over 30 days).` };
  }

  // 6) Best category by 30-day consistency (aggregated across habits)
  const byCat = new Map(); // name -> {done, sched}
  for (const h of active) {
    const cats = (h.categories && h.categories.length) ? h.categories : (h.category ? [h.category] : []);
    if (!cats.length) continue;
    const s = lastNStats(h, logsByHabit.get(h.id) || [], 30, today);
    if (s.sched < 3) continue;
    for (const c of cats) {
      const cur = byCat.get(c) || { done: 0, sched: 0 };
      cur.done += s.done; cur.sched += s.sched;
      byCat.set(c, cur);
    }
  }
  let bestCat = null;
  for (const [name, v] of byCat) {
    const pct = v.sched ? Math.round((v.done / v.sched) * 100) : 0;
    if (v.sched >= 10 && pct >= 70 && (!bestCat || pct > bestCat.pct)) bestCat = { name, pct };
  }
  if (bestCat) return { emoji: '🏷️', text: `${bestCat.name} habits are your most consistent (${bestCat.pct}%).` };

  // 7) Top miss reason (last 30 days)
  const rb = reasonBreakdown(active, logsByHabit, 30, today);
  if (rb.total >= 4) {
    const top = rb.rows[0];
    if (top.pct >= 35) return { emoji: reasonEmoji(top.key), text: `Your top reason for missing lately: “${reasonLabel(top.key).toLowerCase()}” (${top.pct}%).` };
  }

  // 8) Habit-specific reason pattern
  for (const h of active) {
    const tr = topReasonForHabit(h, logsByHabit.get(h.id) || [], 60, today);
    if (tr && tr.count >= 3 && tr.pct >= 50) {
      return { emoji: reasonEmoji(tr.key), text: `You miss ${h.name} mostly because of “${reasonLabel(tr.key).toLowerCase()}”.` };
    }
  }

  return null;
}
