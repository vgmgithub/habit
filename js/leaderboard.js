// leaderboard.js — pure logic for the peer-to-peer Leaderboard feature.
// No DOM, no storage, no network. All transport is WhatsApp links the user
// manually sends; this module only encodes/decodes the payloads carried in
// those links and computes challenge-scoped stats. Everything stays local.
//
// A "challenge" links ONE of my habits to ONE friend, counting only from the
// challenge start date (streak history before that date is ignored — both
// players start fresh when the challenge begins).

import * as M from './model.js';

// ---------------------------------------------------------------------------
// Compact payload schema (short keys → short links). Documented map:
//   t  = type            'i' invite | 'a' accept | 's' sync
//   v  = schema version  (currently 1)
//   c  = challenge id     (shared key both devices agree on)
//   h  = habit name       (the challenge's habit, for display/matching)
//   n  = sender name
//   p  = sender phone     (digits only; may be empty)
//   d  = start date       'YYYY-MM-DD' (canonical challenge start)
//   st = challenge streak (sync)
//   pc = completion %     (sync)
//   dy = completed days   (sync)
//   ts = timestamp (ms)   (sync — for out-of-order detection)
// ---------------------------------------------------------------------------
export const PAYLOAD_VERSION = 1;

// ----- URL-safe base64 encode/decode (UTF-8 safe for unicode names) ---------
export function encodePayload(obj) {
  const json = JSON.stringify(obj);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodePayload(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    const obj = JSON.parse(json);
    return (obj && typeof obj === 'object') ? obj : null;
  } catch (e) { return null; }
}

// ----- Builders: friendly args → compact payload ----------------------------
export function buildInvite({ challengeId, habitName, inviterName, inviterPhone, startDate }) {
  return { t: 'i', v: PAYLOAD_VERSION, c: challengeId, h: habitName || '', n: inviterName || '', p: digits(inviterPhone), d: startDate };
}
export function buildAccept({ challengeId, accepterName, accepterPhone, habitName, startDate }) {
  // habitName (h) + startDate (d) are echoed back from the invite so the inviter
  // can REBUILD the challenge if their local pending copy was lost.
  return { t: 'a', v: PAYLOAD_VERSION, c: challengeId, n: accepterName || '', p: digits(accepterPhone), h: habitName || '', d: startDate || '' };
}
export function buildSync({ challengeId, streak, pct, days, ts }) {
  // NOTE: ts is a ms timestamp (>2^31) — never use `| 0`, which truncates to 32-bit.
  return { t: 's', v: PAYLOAD_VERSION, c: challengeId, st: streak | 0, pc: pct | 0, dy: days | 0, ts: Math.round(ts) || 0 };
}

// ----- Parsers: compact payload → friendly object (null if malformed) -------
export function parseInvite(p) {
  if (!p || p.t !== 'i' || !p.c) return null;
  return { challengeId: p.c, habitName: p.h || '', inviterName: p.n || '', inviterPhone: digits(p.p), startDate: p.d || M.todayStr() };
}
export function parseAccept(p) {
  if (!p || p.t !== 'a' || !p.c) return null;
  return { challengeId: p.c, accepterName: p.n || '', accepterPhone: digits(p.p), habitName: p.h || '', startDate: p.d || '' };
}
export function parseSync(p) {
  if (!p || p.t !== 's' || !p.c) return null;
  return { challengeId: p.c, streak: p.st | 0, pct: p.pc | 0, days: p.dy | 0, ts: Number(p.ts) || 0 };
}

function digits(s) { return (s || '').toString().replace(/[^0-9]/g, ''); }

// ---------------------------------------------------------------------------
// Challenge-scoped stats — counted ONLY from startDate forward.
// Mirrors model.js streak rules (pause/skip neutral) but floors at startDate.
// ---------------------------------------------------------------------------
export function challengeStreak(habit, logs, startDate, today = M.todayStr()) {
  const f = habit.frequency || { type: 'daily' };
  const lmap = M.logMap(logs);
  if (f.type === 'weekly') return weeklyChallengeStreak(habit, lmap, startDate, today);
  let streak = 0;
  let cursor = M.parseYmd(today);
  const floor = M.parseYmd(startDate);
  const todayLog = lmap.get(today);
  // Today still pending? don't break the streak — start counting from yesterday.
  if (M.isScheduled(habit, today) && (!todayLog || todayLog.status === 'pending')) {
    cursor = M.addDays(cursor, -1);
  }
  for (let i = 0; i < 3700; i++) {
    if (cursor < floor) break;             // never count before the challenge began
    const ds = M.ymd(cursor);
    if (M.isScheduled(habit, ds)) {
      const log = lmap.get(ds);
      if (log && log.status === 'done') streak++;
      else if (log && log.status === 'skipped') { /* neutral */ }
      else if (M.isPausedOn(habit, ds)) { /* neutral */ }
      else break;
    }
    cursor = M.addDays(cursor, -1);
  }
  return streak;
}

function weeklyChallengeStreak(habit, lmap, startDate, today) {
  const target = (habit.frequency && habit.frequency.weeklyTarget) || 1;
  const floorWeek = M.weekKey(startDate);
  const byWeek = new Map();
  for (const [date, log] of lmap) {
    if (log.status === 'done' && M.weekKey(date) >= floorWeek) {
      const k = M.weekKey(date);
      byWeek.set(k, (byWeek.get(k) || 0) + 1);
    }
  }
  let streak = 0;
  let cursor = M.startOfWeek(today);
  const thisWeek = M.weekKey(today);
  if ((byWeek.get(thisWeek) || 0) < target) cursor = M.addDays(cursor, -7);
  for (let i = 0; i < 520; i++) {
    const k = M.weekKey(cursor);
    if (k < floorWeek) break;
    if ((byWeek.get(k) || 0) >= target) streak++;
    else break;
    cursor = M.addDays(cursor, -7);
  }
  return streak;
}

// Completion since challenge start: counts scheduled, non-paused days only.
export function challengeStats(habit, logs, startDate, today = M.todayStr()) {
  const lmap = M.logMap(logs);
  let sched = 0, done = 0;
  let cursor = M.parseYmd(startDate);
  const end = M.parseYmd(today);
  while (cursor <= end) {
    const ds = M.ymd(cursor);
    if (M.isScheduled(habit, ds) && !M.isPausedOn(habit, ds)) {
      sched++;
      const log = lmap.get(ds);
      if (log && log.status === 'done') done++;
    }
    cursor = M.addDays(cursor, 1);
  }
  const streak = challengeStreak(habit, logs, startDate, today);
  return { streak, done, sched, pct: sched ? Math.round((done / sched) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Head-to-head comparison for one challenge. `mine`/`theirs` are stat objects
// { streak, done, pct }. Returns ranking + leading + deltas for the UI.
// ---------------------------------------------------------------------------
export function compare(mine, theirs) {
  const myStreak = (mine && mine.streak) | 0;
  const theirStreak = (theirs && theirs.streak) | 0;
  const myPct = (mine && mine.pct) | 0;
  const theirPct = (theirs && theirs.pct) | 0;
  let leader; // 'me' | 'them' | 'tie'  — by streak, completion % breaks ties
  if (myStreak > theirStreak) leader = 'me';
  else if (theirStreak > myStreak) leader = 'them';
  else if (myPct > theirPct) leader = 'me';
  else if (theirPct > myPct) leader = 'them';
  else leader = 'tie';
  return {
    leader,
    myRank: leader === 'them' ? 2 : 1,
    streakDiff: Math.abs(myStreak - theirStreak),
    pctDiff: Math.abs(myPct - theirPct),
  };
}

// Relative "time ago" label for last-synced display.
export function timeAgo(ms, now = Date.now()) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}
