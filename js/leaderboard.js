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
//   v  = schema version  (currently 2)
//   c  = challenge id     (shared key both devices agree on)
//   h  = habit name       (the challenge's habit, for display/matching)
//   n  = sender name
//   p  = sender phone     (digits only; may be empty)
//   d  = start date       'YYYY-MM-DD' (canonical challenge start)
//   dr = duration (days)  (invite/accept)
//   b  = badge           (invite — reputation badge: 'elite' | 'reliable' | 'active' | 'casual')
//   w  = wins            (invite — count of won challenges)
//   l  = losses          (invite — count of lost challenges)
//   ac = active count    (invite — current active challenges)
//   st = challenge streak (sync)
//   pc = completion %     (sync)
//   dy = completed days   (sync)
//   ts = timestamp (ms)   (sync — for out-of-order detection)
// ---------------------------------------------------------------------------
export const PAYLOAD_VERSION = 2;

// Supported challenge durations (days). Creator picks one at invite time.
export const DURATIONS = [7, 15, 30];

// Clamp a received/stored duration to a supported value (default 7 for
// legacy/missing — every challenge must have a duration).
export function normDuration(d) {
  const n = d | 0;
  return DURATIONS.indexOf(n) >= 0 ? n : 7;
}

// ---------------------------------------------------------------------------
// Badge system: editable thresholds for reputation tiers (Phase B).
// Modify thresholds here; they apply immediately without touching stored data.
// ---------------------------------------------------------------------------
export const BADGE_THRESHOLDS = {
  elite: { completionRate: 0.90, wins: 10 },      // 90%+ completion, 10+ wins
  reliable: { completionRate: 0.75, wins: 5 },    // 75%+ completion, 5+ wins
  active: { challengesStarted: 5 },                // 5+ challenges started
  casual: { challengesStarted: 0 },                // Everyone gets casual as fallback
};

// Derive all reputation metrics from local challenges. Pass full state.challenges
// and return { started, completed, completionRate, wins, losses, draws, active, bestStreak }
export function reputationMetrics(allChallenges) {
  const completed = allChallenges.filter((c) => c.status === 'completed' || c.resultsLocked).length;
  const started = allChallenges.length;
  const active = allChallenges.filter((c) => c.status === 'active').length;
  const completionRate = started > 0 ? completed / started : 0;

  let wins = 0, losses = 0, draws = 0, bestStreak = 0;
  allChallenges.forEach((ch) => {
    if (ch.resultsLocked && ch.result) {
      const r = ch.result;
      if (r.winner === 'me') wins++;
      else if (r.winner === 'them') losses++;
      else if (r.winner === 'tie') draws++;
      // Best streak is the max mine.streak we achieved in any challenge
      bestStreak = Math.max(bestStreak, (r.mine && r.mine.streak) || 0);
    }
  });

  return { started, completed, completionRate, wins, losses, draws, active, bestStreak };
}

// Determine badge tier from metrics. Returns one of: 'elite', 'reliable', 'active', 'casual'
export function badgeFor(metrics) {
  const { completionRate, wins, started } = metrics;
  // Tiebreak: elite > reliable > active > casual
  if (completionRate >= BADGE_THRESHOLDS.elite.completionRate && wins >= BADGE_THRESHOLDS.elite.wins) {
    return 'elite';
  }
  if (completionRate >= BADGE_THRESHOLDS.reliable.completionRate && wins >= BADGE_THRESHOLDS.reliable.wins) {
    return 'reliable';
  }
  if (started >= BADGE_THRESHOLDS.active.challengesStarted) {
    return 'active';
  }
  return 'casual';
}

// Badge display info: text, emoji, color
export const BADGE_INFO = {
  elite: { text: 'Elite Challenger', emoji: '🏆', color: '#f59e0b' },
  reliable: { text: 'Reliable Challenger', emoji: '⭐', color: '#3b82f6' },
  active: { text: 'Active Challenger', emoji: '👍', color: '#10b981' },
  casual: { text: 'Casual Challenger', emoji: '🤝', color: '#6b7280' },
};

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
export function buildInvite({ challengeId, habitName, inviterName, inviterPhone, startDate, durationDays, badge, wins, losses, active }) {
  // PRIVACY: never send completion %. Only badge + wins/losses/active.
  return {
    t: 'i', v: PAYLOAD_VERSION, c: challengeId,
    h: habitName || '', n: inviterName || '', p: digits(inviterPhone), d: startDate, dr: normDuration(durationDays),
    b: badge || 'casual', w: wins | 0, l: losses | 0, ac: active | 0,
  };
}
export function buildAccept({ challengeId, accepterName, accepterPhone, habitName, startDate, durationDays, badge, wins, losses, active }) {
  // habitName (h) + startDate (d) + duration (dr) echoed back from invite so
  // inviter can REBUILD if their local pending copy was lost. Also include
  // accepter's badge + reputation for mutual visibility.
  return {
    t: 'a', v: PAYLOAD_VERSION, c: challengeId,
    n: accepterName || '', p: digits(accepterPhone), h: habitName || '', d: startDate || '', dr: normDuration(durationDays),
    b: badge || 'casual', w: wins | 0, l: losses | 0, ac: active | 0,
  };
}
export function buildSync({ challengeId, streak, pct, days, ts }) {
  // NOTE: ts is a ms timestamp (>2^31) — never use `| 0`, which truncates to 32-bit.
  return { t: 's', v: PAYLOAD_VERSION, c: challengeId, st: streak | 0, pc: pct | 0, dy: days | 0, ts: Math.round(ts) || 0 };
}

// ----- Parsers: compact payload → friendly object (null if malformed) -------
export function parseInvite(p) {
  if (!p || p.t !== 'i' || !p.c) return null;
  return {
    challengeId: p.c, habitName: p.h || '', inviterName: p.n || '', inviterPhone: digits(p.p),
    startDate: p.d || M.todayStr(), durationDays: normDuration(p.dr),
    badge: p.b || 'casual', wins: p.w | 0, losses: p.l | 0, active: p.ac | 0,
  };
}
export function parseAccept(p) {
  if (!p || p.t !== 'a' || !p.c) return null;
  return {
    challengeId: p.c, accepterName: p.n || '', accepterPhone: digits(p.p), habitName: p.h || '',
    startDate: p.d || '', durationDays: normDuration(p.dr),
    badge: p.b || 'casual', wins: p.w | 0, losses: p.l | 0, active: p.ac | 0,
  };
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

// ---------------------------------------------------------------------------
// Phase A: Challenge lifecycle, duration, winner declaration
// ---------------------------------------------------------------------------

// Calculate endDate from startDate + durationDays.
export function computeEndDate(startDate, durationDays) {
  const start = M.parseYmd(startDate);
  return M.ymd(M.addDays(start, normDuration(durationDays) - 1));
}

// True if challenge has ended (endDate is before or on today).
export function isExpired(challenge, today = M.todayStr()) {
  const endDate = challenge.endDate || computeEndDate(challenge.startDate, challenge.durationDays);
  return endDate < today || (endDate === today && challenge.status !== 'completed');
}

// Determine winner by tiebreak order: completion % → days → streak → draw.
// Returns { winner: 'me' | 'them' | 'tie', basis: string }
export function declareWinner(mine, theirs) {
  const myPct = (mine && mine.pct) | 0;
  const theirPct = (theirs && theirs.pct) | 0;
  const myDays = (mine && mine.done) | 0;
  const theirDays = (theirs && theirs.done) | 0;
  const myStreak = (mine && mine.streak) | 0;
  const theirStreak = (theirs && theirs.streak) | 0;

  if (myPct !== theirPct) return { winner: myPct > theirPct ? 'me' : 'them', basis: 'completion' };
  if (myDays !== theirDays) return { winner: myDays > theirDays ? 'me' : 'them', basis: 'days' };
  if (myStreak !== theirStreak) return { winner: myStreak > theirStreak ? 'me' : 'them', basis: 'streak' };
  return { winner: 'tie', basis: 'all equal' };
}

// Get stats for a challenge as of its endDate (not today). Returns { streak, done, sched, pct }
// or null if the linked habit is missing. This is used when locking results.
export function getEndStats(habit, logs, challenge) {
  if (!habit) return null;
  const endDate = challenge.endDate || computeEndDate(challenge.startDate, challenge.durationDays);
  return challengeStats(habit, logs, challenge.startDate, endDate);
}

// ---------------------------------------------------------------------------
// Phase C: Friend profiles, insights, milestones, sync health
// ---------------------------------------------------------------------------

// Aggregate stats for one friend across all challenges.
// Returns { active, completed, wins, losses, bestStreak, badge, wins, losses, active }
export function friendProfileStats(friendName, allChallenges) {
  const withFriend = allChallenges.filter(
    (c) => (c.friendName || '').toLowerCase() === (friendName || '').toLowerCase()
  );

  const active = withFriend.filter((c) => c.status === 'active').length;
  const completed = withFriend.filter((c) => c.status === 'completed').length;
  let wins = 0, losses = 0, bestStreak = 0;

  withFriend.forEach((ch) => {
    if (ch.resultsLocked && ch.result) {
      const r = ch.result;
      if (r.winner === 'me') wins++;
      else if (r.winner === 'them') losses++;
      bestStreak = Math.max(bestStreak, (r.mine && r.mine.streak) || 0);
    }
  });

  return { active, completed, wins, losses, bestStreak };
}

// Generate a motivational insight for the current challenge state.
export function motivationalInsight(mine, theirs, myName, friendName) {
  const myStreak = (mine && mine.streak) | 0;
  const theirStreak = (theirs && theirs.streak) | 0;
  const myPct = (mine && mine.pct) | 0;
  const theirPct = (theirs && theirs.pct) | 0;

  if (myStreak > theirStreak) {
    const diff = myStreak - theirStreak;
    return `You're ahead by ${diff} day${diff === 1 ? '' : 's'} — keep it up!`;
  }
  if (theirStreak > myStreak) {
    const diff = theirStreak - myStreak;
    return `${friendName || 'They'} is ahead by ${diff} day${diff === 1 ? '' : 's'} — you can catch up!`;
  }
  if (myPct > theirPct) {
    const diff = myPct - theirPct;
    return `You're leading by ${diff}% completion — finish strong!`;
  }
  if (theirPct > myPct) {
    const diff = theirPct - myPct;
    return `Just ${diff}% behind on completion — one more day could flip it!`;
  }
  return '🤝 Neck and neck — keep going!';
}

// Check for shared milestone achievements.
// Returns array of strings like "Both hit 7-day streak", "Both >90% completion"
export function sharedMilestones(mine, theirs) {
  const milestones = [];
  const myStreak = (mine && mine.streak) | 0;
  const theirStreak = (theirs && theirs.streak) | 0;
  const myPct = (mine && mine.pct) | 0;
  const theirPct = (theirs && theirs.pct) | 0;

  if (myStreak >= 7 && theirStreak >= 7) milestones.push('Both hit 7-day streak');
  if (myStreak >= 15 && theirStreak >= 15) milestones.push('Both hit 15-day streak');
  if (myStreak >= 30 && theirStreak >= 30) milestones.push('Both hit 30-day streak');
  if (myPct >= 90 && theirPct >= 90) milestones.push('Both >90% completion');

  return milestones;
}

// Sync health status: how fresh is the friend's data?
// Returns { status: 'green' | 'yellow' | 'red', label: string }
export function syncHealthStatus(lastSyncedAt, now = Date.now()) {
  if (!lastSyncedAt || lastSyncedAt === 0) return { status: 'gray', label: 'never synced' };
  const ms = now - lastSyncedAt;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  if (days === 0) return { status: 'green', label: 'synced today' };
  if (days <= 7) return { status: 'yellow', label: `${days}d ago` };
  return { status: 'red', label: `${days}d ago` };
}
