// quotes.js — offline motivational quote bank for the Today screen.
//
// Selection model:
//   • TONE  comes from yesterday's completion tier (allDone / partial / none / fresh)
//   • FLAVOR comes from the dominant scheduled category yesterday (General fallback)
//
// `fresh` = no history yet OR yesterday was a rest day (nothing scheduled) — a
// neutral, hopeful tone, never a "you failed" nudge. Only General populates it.
//
// Quotes are a mix of original lines and short, widely-attributed classics.

export const TIER_EMOJI = {
  allDone: ['🎉', '🌟', '🔥', '✨', '🏆'],
  partial: ['💪', '👏', '🚀', '🌤️', '🌱'],
  none:    ['🔥', '⚡', '🌅', '💥', '🎯'],
  fresh:   ['🌱', '🌅', '☀️', '🌿', '✨'],
};

const q = (text, author) => ({ text, author: author || null });

export const QUOTES = {
  General: {
    allDone: [
      q('You showed up fully yesterday. That’s how momentum is built.'),
      q('Every box checked is a promise kept to yourself. Well done.'),
      q('Yesterday you were unstoppable. Carry that fire into today.'),
      q('Consistency like yesterday’s is exactly how big things happen.'),
      q('Success is the sum of small efforts repeated day in and day out.', 'Robert Collier'),
    ],
    partial: [
      q('Progress, not perfection. You moved forward yesterday — keep going.'),
      q('Some is infinitely more than none. Build on what you started.'),
      q('You showed up, even partly. Today’s a chance to go a little further.'),
      q('Half a step still points the right direction. Take the next one.'),
      q('Do what you can, with what you have, where you are.', 'Theodore Roosevelt'),
    ],
    none: [
      q('Yesterday is gone. Today is a clean page — write something good.'),
      q('The hardest rep is the first one. Start now, however small.'),
      q('You don’t need motivation to begin. You need to begin to find it.'),
      q('One small win today resets everything. Go claim it.'),
      q('The secret of getting ahead is getting started.', 'Mark Twain'),
    ],
    fresh: [
      q('A fresh start is a gift. What will you do with today?'),
      q('Today is the first page of a new chapter. Begin.'),
      q('Rest fuels the climb. Now let’s move.'),
      q('Small steps today become who you are tomorrow.'),
      q('The journey of a thousand miles begins with a single step.', 'Lao Tzu'),
    ],
  },

  Health: {
    allDone: [
      q('Your body kept every promise yesterday. Strength is built this way.'),
      q('You honored your health fully. That energy compounds — keep it alive.'),
      q('Strong choices yesterday, stronger you today. Keep moving.'),
      q('Take care of your body. It’s the only place you have to live.', 'Jim Rohn'),
      q('Yesterday you treated your body like it mattered. It does — again today.'),
    ],
    partial: [
      q('Every healthy choice counts, even one. Add another today.'),
      q('Your body noticed the effort yesterday. Give it a little more.'),
      q('Movement begets movement. You started — keep the streak warm.'),
      q('Progress on your health is never wasted. Build on it today.'),
      q('It does not matter how slowly you go, so long as you do not stop.', 'Confucius'),
    ],
    none: [
      q('Your body is waiting for you. One glass, one walk, one rep — start.'),
      q('The best time to move was yesterday. The second best is right now.'),
      q('Health isn’t built in leaps. Take one small action today.'),
      q('Don’t wait to feel ready. Move first, feel better after.'),
      q('A year from now you may wish you had started today.', 'Karen Lamb'),
    ],
  },

  Mindfulness: {
    allDone: [
      q('You gave your mind space yesterday. Peace is a practice — keep it.'),
      q('Stillness honored fully. Carry that calm into today.'),
      q('You showed up for your inner world. That’s quiet strength.'),
      q('The mind is everything. What you think you become.', 'Buddha'),
      q('Yesterday you chose presence over noise. Choose it again.'),
    ],
    partial: [
      q('Even a moment of stillness changes the day. Find another today.'),
      q('You paused yesterday — that matters. Breathe a little longer today.'),
      q('Mindfulness grows one breath at a time. Take the next.'),
      q('A small calm is still calm. Build on it.'),
      q('Quiet the mind, and the soul will speak.', 'Ma Jaya Sati Bhagavati'),
    ],
    none: [
      q('Your mind has been racing. Give it one quiet minute today.'),
      q('Peace doesn’t arrive — you practice it. Begin now.'),
      q('One breath. That’s all today asks of you to start.'),
      q('The calm you’re seeking starts with a single pause. Take it.'),
      q('Within you there is a stillness you can return to at any time.', 'Hermann Hesse'),
    ],
  },

  Productivity: {
    allDone: [
      q('You did the work yesterday. That’s how goals quietly fall.'),
      q('Full focus, full follow-through. Keep that engine running today.'),
      q('Yesterday’s discipline is today’s freedom. Well done.'),
      q('Success is the product of daily habits, not once-in-a-lifetime change.', 'James Clear'),
      q('You finished what you started — rare and powerful. Again today.'),
    ],
    partial: [
      q('You moved the needle yesterday. Nudge it a little more today.'),
      q('Done beats perfect. You started — now continue.'),
      q('Small progress is still progress your future self will thank you for.'),
      q('Momentum likes to be fed. Give it one more task today.'),
      q('Amateurs wait for inspiration. The rest of us just get to work.', 'Stephen King'),
    ],
    none: [
      q('The blank page is heaviest before the first word. Write it.'),
      q('You don’t have to finish — just start. Two minutes. Go.'),
      q('Action cures procrastination. One small task, right now.'),
      q('Yesterday slipped. Today is yours to seize — begin small.'),
      q('The way to get started is to quit talking and begin doing.', 'Walt Disney'),
    ],
  },

  'Personal care': {
    allDone: [
      q('You took care of yourself fully yesterday. You deserve that — again today.'),
      q('Caring for yourself isn’t vanity, it’s maintenance. Beautifully done.'),
      q('Every small ritual kept yesterday says: I matter. Keep saying it.'),
      q('Self-care is how you take your power back.', 'Lalah Delia'),
      q('You showed yourself kindness yesterday. Let it continue.'),
    ],
    partial: [
      q('A little self-care still counts. Give yourself a bit more today.'),
      q('You looked after yourself yesterday — keep that gentleness going.'),
      q('Small rituals, big difference. Add one more today.'),
      q('Tending to yourself is never wasted time. Continue it.'),
      q('Almost everything works again if you unplug it for a bit, including you.', 'Anne Lamott'),
    ],
    none: [
      q('You’ve been pouring out. Pour a little back into yourself today.'),
      q('Self-care isn’t selfish. Start with one small act now.'),
      q('You matter enough for five minutes of care. Take them.'),
      q('The kindest thing today: look after yourself. Begin.'),
      q('You can’t pour from an empty cup. Take care of yourself first.'),
    ],
  },
};

// Deterministic pick: same (category, tier, seed) → same quote (stable per day).
export function pickQuote(category, tier, seed) {
  const cat = QUOTES[category] ? category : 'General';
  let bucket = (QUOTES[cat] && QUOTES[cat][tier]) || QUOTES.General[tier] || QUOTES.General.fresh;
  if (!bucket || !bucket.length) bucket = QUOTES.General.fresh;
  const s = Math.abs(Math.trunc(seed)) || 0;
  const item = bucket[s % bucket.length];
  const emos = TIER_EMOJI[tier] || TIER_EMOJI.fresh;
  const emoji = emos[s % emos.length];
  return { text: item.text, author: item.author, emoji, tier };
}
