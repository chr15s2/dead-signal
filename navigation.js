/**
 * Body-clear squad navigation. Exact positions connect to a conservative grid;
 * every grid edge and every shortcut still passes the world's collision query.
 * MIT licensed; see the project LICENSE.
 */

const CELL = 40;
const WIDTH = 1600;
const HEIGHT = 1200;
const COLS = WIDTH / CELL;
const ROWS = HEIGHT / CELL;
const COUNT = COLS * ROWS;
const BODY_RADIUS = 15;
const ACTOR_RADIUS = 11;
const DIRECTIONS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];
const edgeCaches = new WeakMap();
const pointAt = index => ({
  x: (index % COLS) * CELL + CELL / 2,
  y: Math.floor(index / COLS) * CELL + CELL / 2,
});

// The graph only changes when obstacles change. Cache expensive body-clear edge
// queries across actors; a rebuilt grid or new navigation version invalidates it.
function edgeCache(game) {
  let cache = edgeCaches.get(game);
  if (!cache || cache.grid !== game.grid || cache.version !== game.navVersion) {
    cache = {grid: game.grid, version: game.navVersion, edges: new Uint8Array(COUNT * 8)};
    edgeCaches.set(game, cache);
  }
  return cache.edges;
}

// Avoid snapping through a wall when an actor's cell centre is obstructed.
// Nearby visible centres form virtual edges to the precise actor position. Keep
// one additional ring so a local grid dead end cannot hide the other route out.
function connectors(game, x, y, radius = BODY_RADIUS) {
  const cx = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)));
  const cy = Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)));
  const result = [];
  let finalRing = Infinity;
  for (let ring = 0; ring < Math.max(COLS, ROWS) && ring <= finalRing; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const gx = cx + dx;
        const gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) continue;
        const index = gy * COLS + gx;
        if (game.grid[index]) continue;
        const point = pointAt(index);
        if (!game.walkableSegment(x, y, point.x, point.y, radius)) continue;
        result.push({index, cost: Math.hypot(point.x - x, point.y - y)});
      }
    }
    if (result.length && finalRing === Infinity) finalRing = ring + 1;
  }
  return result;
}

// A small binary heap avoids scanning or removing from the whole open list.
function push(heap, node, score) {
  const entry = {node, score};
  let index = heap.length;
  heap.push(entry);
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (heap[parent].score <= score) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = entry;
}

function pop(heap) {
  const first = heap[0];
  const last = heap.pop();
  if (!heap.length) return first;
  let index = 0;
  while (index * 2 + 1 < heap.length) {
    let child = index * 2 + 1;
    if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
    if (last.score <= heap[child].score) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

function smooth(game, sx, sy, points) {
  const route = [];
  let x = sx;
  let y = sy;
  let next = 0;
  while (next < points.length) {
    let farthest = points.length - 1;
    while (farthest >= next && !game.walkableSegment(x, y, points[farthest].x, points[farthest].y)) farthest--;
    // A failed connector must never become a direct movement fallback.
    if (farthest < next) return [];
    const point = points[farthest];
    route.push(point);
    x = point.x;
    y = point.y;
    next = farthest + 1;
  }
  return route;
}

/** Return safe waypoints, or [] when the exact destination is unreachable. */
export function findRoute(game, sx, sy, ex, ey) {
  if (![sx, sy, ex, ey].every(Number.isFinite)) return [];
  if (game.blocked(sx, sy, ACTOR_RADIUS) || game.blocked(ex, ey, BODY_RADIUS)) return [];
  const escapingPadding = game.blocked(sx, sy, BODY_RADIUS);
  if (!escapingPadding && game.walkableSegment(sx, sy, ex, ey)) return [{x: ex, y: ey}];
  if (!game.grid || game.grid.length !== COUNT) return [];

  const starts = connectors(game, sx, sy, escapingPadding ? ACTOR_RADIUS : BODY_RADIUS);
  const ends = connectors(game, ex, ey);
  if (!starts.length || !ends.length) return [];
  const endCosts = new Float64Array(COUNT).fill(Infinity);
  for (const end of ends) endCosts[end.index] = end.cost;
  const costs = new Float64Array(COUNT).fill(Infinity);
  const parents = new Int16Array(COUNT).fill(-1);
  const closed = new Uint8Array(COUNT);
  const edges = edgeCache(game);
  const heuristic = index => {
    const point = pointAt(index);
    return Math.hypot(point.x - ex, point.y - ey);
  };
  const heap = [];
  for (const start of starts) {
    if (start.cost >= costs[start.index]) continue;
    costs[start.index] = start.cost;
    push(heap, start.index, start.cost + heuristic(start.index));
  }

  let end = -1;
  while (heap.length) {
    const {node: current} = pop(heap);
    if (closed[current]) continue;
    closed[current] = 1;
    // A goal's heuristic equals its real final connector cost. Its first pop
    // therefore has the cheapest complete route among all goal connectors.
    if (Number.isFinite(endCosts[current])) { end = current; break; }
    const cx = current % COLS;
    const cy = Math.floor(current / COLS);
    const point = pointAt(current);
    for (let direction = 0; direction < DIRECTIONS.length; direction++) {
      const [dx, dy] = DIRECTIONS[direction];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const next = ny * COLS + nx;
      if (game.grid[next] || closed[next]) continue;
      if (dx && dy && (game.grid[cy * COLS + nx] || game.grid[ny * COLS + cx])) continue;
      const edge = current * 8 + direction;
      if (!edges[edge]) {
        const neighbor = pointAt(next);
        edges[edge] = game.walkableSegment(point.x, point.y, neighbor.x, neighbor.y) ? 2 : 1;
      }
      if (edges[edge] !== 2) continue;
      const cost = costs[current] + CELL * (dx && dy ? Math.SQRT2 : 1);
      if (cost >= costs[next]) continue;
      costs[next] = cost;
      parents[next] = current;
      push(heap, next, cost + heuristic(next));
    }
  }
  if (end < 0) return [];

  const points = [];
  for (let current = end; current >= 0; current = parents[current]) points.push(pointAt(current));
  points.reverse();
  points.push({x: ex, y: ey});
  if (escapingPadding) {
    // Manual movement can stop closer to cover than the navigation margin.
    // Escape that margin with the physical body, then retain normal clearance.
    // Keep this first hop explicit so smoothing cannot turn it into a long,
    // reduced-clearance shortcut through another part of the map.
    const first = points.shift();
    if (!game.walkableSegment(sx, sy, first.x, first.y, ACTOR_RADIUS)) return [];
    const rest = smooth(game, first.x, first.y, points);
    return rest.length ? [first, ...rest] : [];
  }
  return smooth(game, sx, sy, points);
}
