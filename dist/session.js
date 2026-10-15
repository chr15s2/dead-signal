/** Browser progress and objective text. No DOM or simulation side effects. */
export const SAVE_KEY = 'dead-signal-v1';
export const MISSION_REVISION = 4;

export function normalizeProgress(value) {
  const result = { completed: [], best: {}, difficulty: 'normal', soundOn: false, missionRevision: MISSION_REVISION };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  if (Array.isArray(value.completed)) {
    result.completed = [...new Set(value.completed.filter(id => Number.isInteger(id) && id >= 0 && id < 3))].sort();
  }
  if (value.best && typeof value.best === 'object' && !Array.isArray(value.best)) {
    // Revision 4 replaces the sabotage route and splits the relay between two
    // positions. First Contact is unchanged from revisions 2 and 3.
    const comparable = value.missionRevision === MISSION_REVISION ? [0, 1, 2]
      : [2, 3].includes(value.missionRevision) ? [0] : [];
    for (const id of comparable) {
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
  const objective = state.objective || {type: 'rescue'};
  const pending = objective.type === 'sabotage'
    ? objective.reinforcements?.filter(response => response.pending && !response.spawned).sort((a, b) => a.dueAt - b.dueAt)[0]
    : objective.type === 'holdout' && objective.pendingWave?.pending && !objective.pendingWave.spawned ? objective.pendingWave : null;
  const warningSeconds = pending ? Math.max(0, Math.ceil(pending.dueAt - state.time)) : 0;
  const compass = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  const bearing = Number.isFinite(pending?.direction)
    ? compass[((Math.round(pending.direction / (Math.PI / 4)) % 8) + 8) % 8] : null;
  const direction = bearing ? ` from ${bearing}` : '';
  const warning = pending ? `${objective.type === 'sabotage' ? 'Counterattack' : 'Infected'}${direction}${warningSeconds ? ` in ${warningSeconds}s` : ' approaching'}` : '';
  const site = objective.type === 'holdout' ? objective.sites?.[objective.siteIndex] : null;
  const stage = objective.type === 'operation' ? { stage: objective.phase + 1, stages: objective.stageCount || 4 }
    : site ? {stage: objective.siteIndex + 1, stages: objective.sites.length} : {};
  if (state.extraction.active) {
    if (state.extraction.regrouping) {
      return { ...stage, label: 'REGROUP', text: warning ? `Regroup at the flare. ${warning}.` : state.rescueTarget > 0 ? 'Bring your squad and survivors into the zone.' : 'Bring your squad into the zone.', counter: 'STAY TOGETHER', progress: state.extraction.progress };
    }
    if (state.extraction.progress > 0) {
      return { ...stage, label: 'EXTRACTING', text: 'Hold position. Everyone comes home.', counter: `${Math.round(state.extraction.progress * 100)}%`, progress: state.extraction.progress };
    }
    return { ...stage, label: 'EXTRACTION OPEN', text: warning ? `${warning}. Keep moving to the flare.` : 'Follow the marked flare to the coast.', counter: 'REACH THE FLARE', progress: 0 };
  }
  if (objective.type === 'operation') {
    const point = objective.currentPoints?.[0];
    if (objective.phase === 3) {
      return { ...stage, label: 'EVACUATE EVERYONE', text: 'Escort your squad and both survivors to the flare.', counter: 'REACH THE FLARE', progress: 0 };
    }
    if (objective.phase === 1) {
      const sites = objective.currentPoints || [];
      const siteName = site => site.id === 'clinic' ? 'Clinic' : 'School';
      const detail = !sites.length ? 'Survivors rescued. Regroup for the harbour.' : sites.every(site => !site.remaining)
        ? sites.length > 1 ? 'Both sites clear. Reach either marked survivor.' : `${siteName(sites[0] || {})} clear. Reach the marked survivor.`
        : sites.map(site => site.remaining ? `${siteName(site)}: ${site.remaining} hostile${site.remaining === 1 ? '' : 's'}` : `${siteName(site)} clear`).join(' · ') + '.';
      return { ...stage, label: 'RESCUE BOTH SURVIVORS', text: detail,
        counter: `${state.rescueCount} / ${state.rescueTarget} SAFE`, progress: null };
    }
    const remaining = Math.max(0, point?.remaining || 0);
    return { ...stage, label: objective.phase === 0 ? 'SECURE THE VILLAGE' : 'SECURE THE HARBOUR',
      text: remaining ? 'Clear marked defenders. Approach through cover.' : 'Reach the cleared checkpoint with your leader.',
      counter: remaining ? `${remaining} HOSTILE${remaining === 1 ? '' : 'S'}` : 'REACH CHECKPOINT', progress: null };
  }
  if (objective.type === 'rescue') {
    return { label: 'RESCUE', text: 'Reach the marked survivor. Your squad follows.', counter: `${state.rescueCount} / ${state.rescueTarget} SAFE`, progress: null };
  }
  if (objective.type === 'sabotage') {
    const destroyed = objective.targets.filter(target => !target.alive).length;
    return {label: 'SABOTAGE', text: warning ? `${warning}. Cut the remaining jammer.` : 'Cut both compound jammers, in either order. Watch the lanes.',
      counter: `${destroyed} / ${objective.targets.length} SILENCED`, progress: null};
  }
  if (site) {
    const seconds = Math.max(0, Math.ceil(site.duration - site.held - 1e-9));
    const finalSite = objective.siteIndex === objective.sites.length - 1;
    const place = finalSite ? 'RIDGE MAST' : 'REPEATER';
    const started = objective.siteStarted || site.held > 0;
    const detail = objective.inside ? 'Keep your selected soldier in the circle.'
      : started ? 'Progress saved. Return to this circle when safe.'
        : finalSite ? 'First link complete. Reach the ridge mast.' : 'Enter the village repeater circle to transmit.';
    return {...stage, label: `${objective.inside ? 'HOLD' : 'REACH'} ${place}`,
      text: warning ? `${warning}. ${objective.inside ? 'Hold or reposition.' : 'Reach the active circle.'}` : detail,
      counter: `${seconds} SEC ${started ? 'LEFT' : 'SIGNAL'}`,
      progress: Math.min(1, site.held / site.duration),
      progressLabel: `${site.label || (finalSite ? 'Ridge mast' : 'Village repeater')} uplink progress`};
  }
  const seconds = Math.max(0, Math.ceil(objective.duration - objective.held - 1e-9));
  if (!objective.started) {
    return {label: 'REACH THE RELAY', text: 'Enter the marked perimeter to start transmitting.',
      counter: `${objective.duration} SEC SIGNAL`, progress: 0};
  }
  return {label: objective.inside ? 'HOLD THE SIGNAL' : 'RE-ENTER THE SIGNAL',
    text: objective.inside ? warning ? `${warning}. Hold or reposition.` : 'Keep your selected soldier inside. Survive the infected waves.' : warning ? `${warning}. Return when safe; progress is saved.` : 'Return to the perimeter. Transmission progress is saved.',
    counter: `${seconds} SEC LEFT`, progress: Math.min(1, objective.held / objective.duration)};
}
