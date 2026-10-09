/** Browser progress and objective text. No DOM or simulation side effects. */
export const SAVE_KEY = 'dead-signal-v1';
export const MISSION_REVISION = 1;

export function normalizeProgress(value) {
  const result = { completed: [], best: {}, difficulty: 'normal', soundOn: false, missionRevision: MISSION_REVISION };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  if (Array.isArray(value.completed)) {
    result.completed = [...new Set(value.completed.filter(id => Number.isInteger(id) && id >= 0 && id < 3))].sort();
  }
  if (value.best && typeof value.best === 'object' && !Array.isArray(value.best)) {
    // The new sabotage and relay runs cannot be compared to their old rescue
    // and clear-the-map times. Keep campaign completion, preferences and M1.
    const unchangedTimes = value.missionRevision === MISSION_REVISION;
    for (let id = 0; id < (unchangedTimes ? 3 : 1); id++) {
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
  if (state.extraction.active) {
    if (state.extraction.regrouping) {
      return { label: 'REGROUP', text: state.rescueTarget > 0 ? 'Bring your squad and survivors into the zone.' : 'Bring your squad into the zone.', counter: 'STAY TOGETHER', progress: state.extraction.progress };
    }
    if (state.extraction.progress > 0) {
      return { label: 'EXTRACTING', text: 'Hold position. Everyone comes home.', counter: `${Math.round(state.extraction.progress * 100)}%`, progress: state.extraction.progress };
    }
    return { label: 'EXTRACTION OPEN', text: 'Follow the marked flare to the coast.', counter: 'REACH THE FLARE', progress: 0 };
  }
  const objective = state.objective || {type: 'rescue'};
  if (objective.type === 'rescue') {
    return { label: 'RESCUE', text: 'Reach the marked survivor. Your squad follows.', counter: `${state.rescueCount} / ${state.rescueTarget} SAFE`, progress: null };
  }
  if (objective.type === 'sabotage') {
    const destroyed = objective.targets.filter(target => !target.alive).length;
    return {label: 'SABOTAGE', text: 'Destroy both marked jammers. Gunfire or grenades work.',
      counter: `${destroyed} / ${objective.targets.length} SILENCED`, progress: null};
  }
  const seconds = Math.max(0, Math.ceil(objective.duration - objective.held - 1e-9));
  if (!objective.started) {
    return {label: 'REACH THE RELAY', text: 'Enter the marked perimeter to start transmitting.',
      counter: `${objective.duration} SEC SIGNAL`, progress: 0};
  }
  return {label: objective.inside ? 'HOLD THE SIGNAL' : 'RE-ENTER THE SIGNAL',
    text: objective.inside ? 'Keep your selected soldier inside. Survive the infected waves.' : 'Return to the perimeter. Transmission progress is saved.',
    counter: `${seconds} SEC LEFT`, progress: Math.min(1, objective.held / objective.duration)};
}
