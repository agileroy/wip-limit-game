import { dishesAt, downstreamOf, hasLimits, isReadyAt, limitOf, stationLoad, upstreamOf, usefulPoints } from './engine';
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
 * Cuisinier « qui dit oui à tout » : il démarre une nouvelle commande à chaque tour et répartit ses points
 * entre plusieurs plats. C'est le comportement typique d'une équipe sans limite.
 */
export function greedyBot(state: KitchenState, station: StationId, roll: number, cfg: GameConfig, claimed: Set<string>): Allocation {
  const own = dishesAt(state, station).filter((d) => remaining(d, station) > 0);
  const incoming = upstreamReady(state, station).filter((d) => !claimed.has(d.id)).slice(0, 1);
  const targets = [...own.slice(0, 3), ...incoming];
  if (!targets.length) return {};
  let pts = usefulPoints(roll, targets.length, cfg);
  const alloc: Allocation = {};
  let guard = 0;
  while (pts > 0 && guard < 50) {
    guard += 1;
    const open = targets.filter((d) => (alloc[d.id] ?? 0) < (d.location === station ? remaining(d, station) : d.work[station]));
    if (!open.length) break;
    const d = open[guard % open.length];
    alloc[d.id] = (alloc[d.id] ?? 0) + 1;
    pts -= 1;
  }
  for (const id of Object.keys(alloc)) claimed.add(id);
  return alloc;
}

/**
 * Cuisinier « finir avant de commencer » : il prend le plat le plus ancien que personne
 * de sa station n'a déjà pris ce tour-ci, et ne tire du nouveau que s'il reste de la place.
 * Au service 3, quand sa station n'a rien à faire ou que la suivante est pleine, il aide en aval.
 */
export function focusedBot(state: KitchenState, station: StationId, roll: number, cfg: GameConfig, claimed: Set<string>): Allocation {
  const limited = hasLimits(state.mode);
  const own = dishesAt(state, station).filter((d) => remaining(d, station) > 0 && !claimed.has(d.id));
  const pulledThisTurn = [...claimed].filter((id) => {
    const d = state.dishes[id];
    return d && d.location !== station && upstreamReady(state, station).includes(d);
  }).length;
  const room = !limited || stationLoad(state, station) + pulledThisTurn < limitOf(state, station, cfg);
  const incoming = room ? upstreamReady(state, station).filter((d) => !claimed.has(d.id)) : [];

  // Au service 3 : si la station suivante est pleine, on l'aide avant de démarrer du neuf
  if (state.mode === 'swarm') {
    const next = downstreamOf(station)[0];
    const nextBlocked = next && stationLoad(state, next) >= limitOf(state, next, cfg);
    if ((!own.length && (nextBlocked || !incoming.length)) && next) {
      for (const s of downstreamOf(station)) {
        const d = dishesAt(state, s).find((x) => remaining(x, s) > 0 && !claimed.has(x.id));
        if (d) {
          claimed.add(d.id);
          return { [d.id]: Math.min(roll, remaining(d, s)) };
        }
      }
    }
  }

  const first = own[0] ?? incoming[0];
  if (!first) return {};
  claimed.add(first.id);
  const need = first.location === station ? remaining(first, station) : first.work[station];
  if (roll <= need) return { [first.id]: roll };
  // Il reste des points : on passe au plat suivant seulement si ça vaut le coût du changement
  const alloc: Allocation = { [first.id]: need };
  const leftover = roll - need - cfg.contextSwitchCost;
  const pullsUsed = pulledThisTurn + (own.includes(first) ? 0 : 1);
  const roomForSecond = !limited || stationLoad(state, station) + pullsUsed < limitOf(state, station, cfg);
  const second = own.find((d) => d.id !== first.id) ?? (roomForSecond ? upstreamReady(state, station).find((d) => d.id !== first.id && !claimed.has(d.id)) : undefined);
  if (leftover >= 1 && second) {
    alloc[second.id] = Math.min(leftover, second.location === station ? remaining(second, station) : second.work[station]);
    claimed.add(second.id);
  }
  return alloc;
}

/** Les robots d'une même station se répartissent les plats via `claimed`. */
export function botAllocation(
  state: KitchenState,
  station: StationId,
  roll: number,
  cfg: GameConfig,
  claimed: Set<string> = new Set(),
): Allocation {
  return state.mode === 'free' ? greedyBot(state, station, roll, cfg, claimed) : focusedBot(state, station, roll, cfg, claimed);
}
