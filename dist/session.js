/** Browser progress and objective text. No DOM or simulation side effects. */
export const SAVE_KEY = 'dead-signal-v1';

export function normalizeProgress(value) {
  const result = { completed: [], best: {}, difficulty: 'normal', soundOn: false };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  if (Array.isArray(value.completed)) {
    result.completed = [...new Set(value.completed.filter(id => Number.isInteger(id) && id >= 0 && id < 3))].sort();
  }
  if (value.best && typeof value.best === 'object' && !Array.isArray(value.best)) {
    for (let id = 0; id < 3; id++) {
      const time = value.best[id];
      if (typeof time === 'number' && Number.isFinite(time) && time > 0) result.best[id] = time;
    }
  }
  if (['normal', 'easy', 'hard'].includes(value.difficulty)) result.difficulty = value.difficulty;
  result.soundOn = value.soundOn === true;
  return result;
}

export function loadProgress(storage) {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(SAVE_KEY);
    return normalizeProgress(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeProgress(null);
  }
}

export function saveProgress(storage, value) {
  try {
    const destination = storage ?? globalThis.localStorage;
    if (!destination) return false;
    destination.setItem(SAVE_KEY, JSON.stringify(normalizeProgress(value)));
    return true;
  } catch {
    // Private browsing and denied storage never interrupt a mission.
    return false;
  }
}

export function objectiveFor(state) {
  const remaining = state.enemies.filter(enemy => enemy.alive).length;
  if (state.extraction.active) {
    if (state.extraction.regrouping) {
      return { label: 'REGROUP', text: 'Bring your squad and survivors into the zone.', counter: 'STAY TOGETHER', progress: state.extraction.progress };
    }
    if (state.extraction.progress > 0) {
      return { label: 'EXTRACTING', text: 'Hold position. Everyone comes home.', counter: `${Math.round(state.extraction.progress * 100)}%`, progress: state.extraction.progress };
    }
    return { label: 'EXTRACTION OPEN', text: 'Follow the green flare to the coast.', counter: 'REACH THE FLARE', progress: 0 };
  }
  if (state.rescueCount < state.rescueTarget) {
    return { label: 'RESCUE', text: 'Reach the marked survivor. Your squad follows.', counter: `${state.rescueCount} / ${state.rescueTarget} SAFE`, progress: null };
  }
  return {
    label: remaining ? 'SECURE THE AREA' : 'HOLD THE PERIMETER',
    text: state.wavesRemaining > 0 ? `${state.wavesRemaining} infected ${state.wavesRemaining === 1 ? 'wave remains' : 'waves remain'}. Watch your noise.` : 'Clear the last hostiles to open extraction.',
    counter: `${remaining} HOSTILE${remaining === 1 ? '' : 'S'}`,
    progress: null,
  };
}
