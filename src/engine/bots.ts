import { dishesAt, downstreamOf, hasLimits, isReadyAt, upstreamOf, usefulPoints } from './engine';
import { Allocation, Dish, GameConfig, KitchenState, StationId } from './types';

function remaining(d: Dish, s: StationId): number {
  return d.work[s] - d.done[s];
}

function upstreamReady(state: KitchenState, station: StationId): Dish[] {
  const up = upstreamOf(station);
  if (up === 'backlog') return dishesAt(state, 'backlog');
  return dishesAt(state, up).filter((d) => isReadyAt(d, up));
}

/**
 * Cuisinier « qui dit oui à tout » : il démarre tout ce qui arrive et répartit ses points.
 * C'est le comportement typique d'une équipe sans limite.
 */
export function greedyBot(state: KitchenState, station: StationId, roll: number, cfg: GameConfig): Allocation {
  const own = dishesAt(state, station).filter((d) => remaining(d, station) > 0);
  const incoming = upstreamReady(state, station).slice(0, 2);
  const targets = [...own, ...incoming].slice(0, 4);
  if (!targets.length) return {};
  let pts = usefulPoints(roll, targets.length, cfg);
  const alloc: Allocation = {};
  let i = 0;
  while (pts > 0 && i < targets.length * 6) {
    const d = targets[i % targets.length];
    const already = alloc[d.id] ?? 0;
    if (already < remaining(d, station) || d.location !== station) {
      alloc[d.id] = already + 1;
      pts -= 1;
    }
    i += 1;
  }
  return alloc;
}

/** Cuisinier « finir avant de commencer » : un plat à la fois, le plus ancien d'abord. */
export function focusedBot(state: KitchenState, station: StationId, roll: number, cfg: GameConfig): Allocation {
  const own = dishesAt(state, station).filter((d) => remaining(d, station) > 0);
  if (own.length) return { [own[0].id]: roll };
  const load = dishesAt(state, station).length;
  const canPullMore = !hasLimits(state.mode) || load < cfg.wipLimit;
  const incoming = upstreamReady(state, station);
  if (canPullMore && incoming.length) return { [incoming[0].id]: roll };
  if (state.mode === 'swarm') {
    for (const s of downstreamOf(station)) {
      const d = dishesAt(state, s).find((x) => remaining(x, s) > 0);
      if (d) return { [d.id]: roll };
    }
  }
  return {};
}

export function botAllocation(state: KitchenState, station: StationId, roll: number, cfg: GameConfig): Allocation {
  return state.mode === 'free' ? greedyBot(state, station, roll, cfg) : focusedBot(state, station, roll, cfg);
}
