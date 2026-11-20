import {
  Allocation,
  Dish,
  GameConfig,
  KitchenState,
  PlayerAction,
  PlayerInfo,
  RoundMode,
  RoundSummary,
  STATIONS,
  StationId,
  TurnMetric,
} from './types';

// ---------- Hasard reproductible ----------

/** mulberry32 : renvoie [valeur dans [0,1[, nouvel état] */
export function nextRandom(state: number): [number, number] {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, a];
}

class Rng {
  constructor(public state: number) {}
  next(): number {
    const [v, s] = nextRandom(this.state);
    this.state = s;
    return v;
  }
  die(): number {
    return 1 + Math.floor(this.next() * 6);
  }
  pick<T>(list: T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
}

// ---------- Carte du restaurant ----------

export const MENU: { recipe: string; work: Record<StationId, number> }[] = [
  { recipe: 'Risotto', work: { prep: 3, cook: 4, plate: 2 } },
  { recipe: 'Tartare', work: { prep: 3, cook: 1, plate: 2 } },
  { recipe: 'Burger', work: { prep: 2, cook: 3, plate: 2 } },
  { recipe: 'Soupe', work: { prep: 2, cook: 3, plate: 1 } },
  { recipe: 'Pavé', work: { prep: 2, cook: 4, plate: 2 } },
  { recipe: 'Magret', work: { prep: 3, cook: 4, plate: 3 } },
  { recipe: 'Lasagnes', work: { prep: 3, cook: 4, plate: 2 } },
  { recipe: 'Salade', work: { prep: 3, cook: 1, plate: 2 } },
];

// ---------- Aides ----------

export function upstreamOf(station: StationId): StationId | 'backlog' {
  const i = STATIONS.indexOf(station);
  return i === 0 ? 'backlog' : STATIONS[i - 1];
}

export function downstreamOf(station: StationId): StationId[] {
  return STATIONS.slice(STATIONS.indexOf(station) + 1);
}

export function isReadyAt(dish: Dish, station: StationId): boolean {
  return dish.location === station && dish.done[station] >= dish.work[station];
}

export function dishesAt(state: KitchenState, location: Dish['location']): Dish[] {
  return Object.values(state.dishes ?? {})
    .filter((d) => d.location === location)
    .sort((a, b) => Number(b.vip) - Number(a.vip) || a.arrivedTurn - b.arrivedTurn || a.id.localeCompare(b.id, 'fr', { numeric: true }));
}

export function stationLoad(state: KitchenState, station: StationId): number {
  return dishesAt(state, station).length;
}

/** Limite d'une station : wipLimit pour 1 cuisinier, +1 par cuisinier supplémentaire. */
export function stationLimit(cfg: GameConfig, staff: number): number {
  return cfg.wipLimit + Math.max(0, staff - 1);
}

export function computeLimits(players: PlayerInfo[], cfg: GameConfig): Record<StationId, number> {
  const out = {} as Record<StationId, number>;
  for (const s of STATIONS) out[s] = stationLimit(cfg, players.filter((p) => p.station === s).length);
  return out;
}

export function limitOf(state: KitchenState, station: StationId, cfg: GameConfig): number {
  return state.limits?.[station] ?? cfg.wipLimit;
}

export function hasLimits(mode: RoundMode): boolean {
  return mode !== 'free';
}

/** Un plat peut-il être tiré dans la station (depuis l'amont) ? */
export function canPull(_state: KitchenState, dish: Dish, station: StationId): boolean {
  const up = upstreamOf(station);
  if (up === 'backlog') return dish.location === 'backlog';
  return isReadyAt(dish, up);
}

export type TargetKind = 'own' | 'pull' | 'help';

/** Ce qu'un joueur d'une station peut faire sur un plat, ou null s'il ne peut rien. */
export function targetKind(state: KitchenState, dish: Dish, station: StationId): TargetKind | null {
  if (dish.location === station) return dish.done[station] < dish.work[station] ? 'own' : null;
  if (canPull(state, dish, station)) return 'pull';
  if (state.mode === 'swarm' && downstreamOf(station).includes(dish.location as StationId)) {
    const loc = dish.location as StationId;
    return dish.done[loc] < dish.work[loc] ? 'help' : null;
  }
  return null;
}

/** Points utiles d'un joueur selon le nombre de plats touchés dans le tour. */
export function usefulPoints(roll: number, touched: number, cfg: GameConfig): number {
  if (touched <= 1) return roll;
  return Math.max(0, roll - cfg.contextSwitchCost * (touched - 1));
}

/** Nettoie une allocation : points entiers positifs, total plafonné aux points utiles. */
export function normalizeAllocation(alloc: Allocation | undefined, roll: number, cfg: GameConfig): Allocation {
  const entries = Object.entries(alloc ?? {})
    .map(([id, p]) => [id, Math.max(0, Math.floor(Number(p) || 0))] as [string, number])
    .filter(([, p]) => p > 0);
  const useful = usefulPoints(roll, entries.length, cfg);
  let left = useful;
  const out: Allocation = {};
  for (const [id, p] of entries) {
    const take = Math.min(p, left);
    if (take > 0) out[id] = take;
    left -= take;
  }
  return out;
}

export function dishValue(dish: Dish, finishedTurn: number, cfg: GameConfig): number {
  const base = dish.vip ? cfg.dishValue * 2 : cfg.dishValue;
  const age = finishedTurn - (dish.startedTurn ?? finishedTurn) + 1;
  return Math.max(0, base - cfg.decayPerTurn * Math.max(0, age - cfg.coolGrace));
}

/** Valeur actuelle (si servi maintenant) d'un plat entamé. */
export function currentValue(dish: Dish, turn: number, cfg: GameConfig): number {
  if (dish.value != null) return dish.value;
  if (dish.startedTurn == null) return dish.vip ? cfg.dishValue * 2 : cfg.dishValue;
  return dishValue(dish, turn, cfg);
}

function makeDish(state: KitchenState, rng: Rng, turn: number, vip = false): Dish {
  const item = rng.pick(MENU);
  const id = `d${state.nextDishId}`;
  state.nextDishId += 1;
  return {
    id,
    recipe: item.recipe,
    work: { ...item.work },
    done: { prep: 0, cook: 0, plate: 0 },
    location: 'backlog',
    arrivedTurn: turn,
    startedTurn: null,
    finishedTurn: null,
    value: null,
    vip,
  };
}

function minStaff(players: PlayerInfo[]): number {
  const counts = STATIONS.map((s) => players.filter((p) => p.station === s).length);
  return Math.max(1, Math.min(...counts));
}

function rollAll(players: PlayerInfo[], rng: Rng): Record<string, number> {
  const rolls: Record<string, number> = {};
  for (const p of [...players].sort((a, b) => a.uid.localeCompare(b.uid))) rolls[p.uid] = rng.die();
  return rolls;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Firebase supprime les objets vides : on remet les champs manquants. */
export function hydrate(state: KitchenState): KitchenState {
  return {
    ...state,
    dishes: state.dishes ?? {},
    rolls: state.rolls ?? {},
    metrics: state.metrics ?? [],
    log: state.log ?? [],
    wasted: state.wasted ?? 0,
  };
}

// ---------- Cycle de jeu ----------

export function newRound(mode: RoundMode, players: PlayerInfo[], cfg: GameConfig, seed: number): KitchenState {
  const rng = new Rng(seed);
  const state: KitchenState = {
    mode,
    turn: 1,
    dishes: {},
    nextDishId: 1,
    rolls: {},
    limits: computeLimits(players, cfg),
    rng: 0,
    arrivalAcc: 0,
    metrics: [],
    wasted: 0,
    log: [],
  };
  for (let i = 0; i < cfg.initialOrders; i++) {
    const d = makeDish(state, rng, 0);
    state.dishes[d.id] = d;
  }
  state.rolls = rollAll(players, rng);
  state.rng = rng.state;
  return state;
}

export function addOrders(stateIn: KitchenState, count: number, vip: boolean): KitchenState {
  const state = clone(hydrate(stateIn));
  const rng = new Rng(state.rng);
  for (let i = 0; i < count; i++) {
    const d = makeDish(state, rng, state.turn, vip);
    state.dishes[d.id] = d;
  }
  state.rng = rng.state;
  return state;
}

/**
 * Résout le tour courant à partir des actions des joueurs, puis prépare le tour suivant.
 * Ordre : tirages de l'aval vers l'amont, travail, service, départs de clients, arrivées.
 */
export function resolveTurn(
  stateIn: KitchenState,
  players: PlayerInfo[],
  actions: Record<string, PlayerAction | undefined>,
  cfg: GameConfig,
): KitchenState {
  const state = clone(hydrate(stateIn));
  const rng = new Rng(state.rng);
  const turn = state.turn;
  const log: string[] = [];
  const limited = hasLimits(state.mode);

  // Allocations nettoyées, par joueur, dans l'ordre de validation
  const ordered = [...players].sort((a, b) => {
    const ta = actions[a.uid]?.submittedAt ?? Infinity;
    const tb = actions[b.uid]?.submittedAt ?? Infinity;
    return ta - tb || a.uid.localeCompare(b.uid);
  });
  const allocs = new Map<string, Allocation>();
  for (const p of ordered) {
    const roll = state.rolls[p.uid] ?? 0;
    const raw = actions[p.uid]?.alloc ?? {};
    const alloc = normalizeAllocation(raw, roll, cfg);
    const spent = Object.values(alloc).reduce((s, v) => s + v, 0);
    state.wasted += roll - spent;
    allocs.set(p.uid, alloc);
  }

  // 1. Tirages, de l'aval vers l'amont pour que la place libérée profite à l'amont
  const pullOk = new Set<string>(); // `${uid}:${dishId}`
  for (const station of [...STATIONS].reverse()) {
    for (const p of ordered.filter((pl) => pl.station === station)) {
      for (const dishId of Object.keys(allocs.get(p.uid) ?? {})) {
        const dish = state.dishes[dishId];
        if (!dish) continue;
        if (dish.location === station) {
          pullOk.add(`${p.uid}:${dishId}`);
          continue;
        }
        if (!canPull(state, dish, station)) continue;
        if (limited && stationLoad(state, station) >= limitOf(state, station, cfg)) {
          log.push(`${dish.recipe} refusé en ${station} : limite atteinte`);
          continue;
        }
        dish.location = station;
        if (station === 'prep') dish.startedTurn = turn;
        pullOk.add(`${p.uid}:${dishId}`);
      }
    }
  }

  // 2. Travail
  for (const p of ordered) {
    for (const [dishId, pts] of Object.entries(allocs.get(p.uid) ?? {})) {
      const dish = state.dishes[dishId];
      if (!dish) {
        state.wasted += pts;
        continue;
      }
      let target: StationId | null = null;
      if (pullOk.has(`${p.uid}:${dishId}`) && dish.location === p.station) target = p.station;
      else if (state.mode === 'swarm' && downstreamOf(p.station).includes(dish.location as StationId)) {
        target = dish.location as StationId;
      }
      if (!target) {
        state.wasted += pts;
        continue;
      }
      const room = dish.work[target] - dish.done[target];
      const applied = Math.min(room, pts);
      dish.done[target] += applied;
      state.wasted += pts - applied;
    }
  }

  // 3. Service : les plats dressés partent en salle
  for (const dish of Object.values(state.dishes)) {
    if (dish.location === 'plate' && dish.done.plate >= dish.work.plate) {
      dish.location = 'served';
      dish.finishedTurn = turn;
      dish.value = dishValue(dish, turn, cfg);
      log.push(`${dish.recipe} servi : ${dish.value} €`);
    }
  }

  // 4. Clients impatients
  for (const dish of Object.values(state.dishes)) {
    if (dish.location === 'backlog' && turn - dish.arrivedTurn >= cfg.patience) {
      dish.location = 'lost';
      dish.finishedTurn = turn;
      log.push(`Client parti : ${dish.recipe} jamais commencé`);
    }
  }

  // 5. Métriques du tour
  state.metrics.push(snapshot(state, turn));

  // 6. Tour suivant : arrivées et dés
  state.turn = turn + 1;
  if (state.turn <= cfg.turnsPerRound) {
    state.arrivalAcc += cfg.arrivalsPerBrigade * minStaff(players);
    let arrivals = Math.floor(state.arrivalAcc);
    state.arrivalAcc -= arrivals;
    if (rng.next() < state.arrivalAcc) {
      arrivals += 1;
      state.arrivalAcc -= 1;
    }
    for (let i = 0; i < arrivals; i++) {
      const d = makeDish(state, rng, state.turn);
      state.dishes[d.id] = d;
    }
    state.rolls = rollAll(players, rng);
  } else {
    state.rolls = {};
  }
  state.rng = rng.state;
  state.log = log;
  return state;
}

export function snapshot(state: KitchenState, turn: number): TurnMetric {
  const all = Object.values(state.dishes ?? {});
  const served = all.filter((d) => d.location === 'served');
  return {
    turn,
    wip: all.filter((d) => STATIONS.includes(d.location as StationId)).length,
    served: served.length,
    revenue: served.reduce((s, d) => s + (d.value ?? 0), 0),
    lost: all.filter((d) => d.location === 'lost').length,
  };
}

export function isRoundOver(state: KitchenState, cfg: GameConfig): boolean {
  return state.turn > cfg.turnsPerRound;
}

export function summarize(stateIn: KitchenState): RoundSummary {
  const state = hydrate(stateIn);
  const all = Object.values(state.dishes);
  const served = all.filter((d) => d.location === 'served');
  const metrics = state.metrics;
  const last = metrics[metrics.length - 1] ?? { served: 0, revenue: 0, lost: 0 };
  const avgWip = metrics.length ? metrics.reduce((s, m) => s + m.wip, 0) / metrics.length : 0;
  const cycles = served.map((d) => (d.finishedTurn ?? 0) - (d.startedTurn ?? 0) + 1);
  const avgCycle = cycles.length ? cycles.reduce((s, c) => s + c, 0) / cycles.length : 0;
  return {
    mode: state.mode,
    served: last.served,
    revenue: last.revenue,
    lost: last.lost,
    avgWip: round1(avgWip),
    avgCycle: round1(avgCycle),
    throughput: metrics.length ? round1(last.served / metrics.length) : 0,
    wasted: state.wasted,
    metrics,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
