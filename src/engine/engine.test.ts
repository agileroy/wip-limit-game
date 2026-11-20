import { describe, expect, it } from 'vitest';
import { botAllocation } from './bots';
import {
  addOrders,
  dishValue,
  isRoundOver,
  newRound,
  normalizeAllocation,
  resolveTurn,
  summarize,
  targetKind,
  usefulPoints,
} from './engine';
import { DEFAULT_CONFIG, Dish, KitchenState, PlayerAction, PlayerInfo, RoundMode, StationId } from './types';

const cfg = DEFAULT_CONFIG;
const brigade: PlayerInfo[] = [
  { uid: 'a', station: 'prep' },
  { uid: 'b', station: 'cook' },
  { uid: 'c', station: 'plate' },
];

function dish(id: string, location: Dish['location'], done: Partial<Record<StationId, number>> = {}, startedTurn: number | null = 1): Dish {
  return {
    id,
    recipe: 'Test',
    work: { prep: 2, cook: 2, plate: 2 },
    done: { prep: 0, cook: 0, plate: 0, ...done },
    location,
    arrivedTurn: 0,
    startedTurn: location === 'backlog' ? null : startedTurn,
    finishedTurn: null,
    value: null,
    vip: false,
  };
}

function kitchen(mode: RoundMode, dishes: Dish[], rolls: Record<string, number>): KitchenState {
  return {
    mode,
    turn: 1,
    dishes: Object.fromEntries(dishes.map((d) => [d.id, d])),
    nextDishId: 100,
    rolls,
    limits: { prep: 2, cook: 2, plate: 2 },
    rng: 42,
    arrivalAcc: 0,
    metrics: [],
    wasted: 0,
    log: [],
  };
}

const act = (alloc: Record<string, number>, submittedAt = 1): PlayerAction => ({ alloc, submittedAt, done: true });

describe('changement de contexte', () => {
  it('coûte 1 point par plat supplémentaire', () => {
    expect(usefulPoints(4, 1, cfg)).toBe(4);
    expect(usefulPoints(4, 2, cfg)).toBe(3);
    expect(usefulPoints(4, 4, cfg)).toBe(1);
    expect(usefulPoints(2, 4, cfg)).toBe(0);
  });

  it('plafonne une allocation aux points utiles', () => {
    expect(normalizeAllocation({ x: 3, y: 3 }, 4, cfg)).toEqual({ x: 3 });
    expect(normalizeAllocation({ x: 1, y: 1, z: 1 }, 6, cfg)).toEqual({ x: 1, y: 1, z: 1 });
    expect(normalizeAllocation({ x: -2, y: 0 }, 6, cfg)).toEqual({});
  });
});

describe('valeur des plats', () => {
  it('reste à 20 € pendant le délai de grâce puis perd 2 € par tour', () => {
    const d = dish('d1', 'plate', {}, 1);
    expect(dishValue(d, 3, cfg)).toBe(20);
    expect(dishValue(d, 4, cfg)).toBe(18);
    expect(dishValue(d, 20, cfg)).toBe(0);
  });

  it('un plat VIP vaut le double', () => {
    expect(dishValue({ ...dish('d1', 'plate'), vip: true }, 1, cfg)).toBe(40);
  });
});

describe('résolution d\'un tour', () => {
  it('tire une commande en préparation et la démarre', () => {
    const s = kitchen('free', [dish('d1', 'backlog')], { a: 3, b: 1, c: 1 });
    const next = resolveTurn(s, brigade, { a: act({ d1: 3 }) }, cfg);
    expect(next.dishes.d1.location).toBe('prep');
    expect(next.dishes.d1.done.prep).toBe(2);
    expect(next.dishes.d1.startedTurn).toBe(1);
    expect(next.turn).toBe(2);
  });

  it('refuse un tirage au-delà de la limite de WIP', () => {
    const s = kitchen('limit', [dish('d1', 'prep'), dish('d2', 'prep'), dish('d3', 'backlog')], { a: 6, b: 1, c: 1 });
    const next = resolveTurn(s, brigade, { a: act({ d3: 2 }) }, cfg);
    expect(next.dishes.d3.location).toBe('backlog');
  });

  it('sans limite, le tirage est toujours accepté', () => {
    const s = kitchen('free', [dish('d1', 'prep'), dish('d2', 'prep'), dish('d3', 'backlog')], { a: 6, b: 1, c: 1 });
    const next = resolveTurn(s, brigade, { a: act({ d3: 2 }) }, cfg);
    expect(next.dishes.d3.location).toBe('prep');
  });

  it("libère de la place de l'aval vers l'amont dans le même tour", () => {
    const s = kitchen(
      'limit',
      [dish('d1', 'cook', { prep: 2, cook: 2 }), dish('d2', 'cook', { prep: 2 }), dish('d3', 'prep', { prep: 2 })],
      { a: 1, b: 2, c: 2 },
    );
    // Le dressage tire d1, ce qui libère une place en cuisson pour d3
    const next = resolveTurn(s, brigade, { c: act({ d1: 2 }), b: act({ d3: 2 }) }, cfg);
    expect(next.dishes.d1.location).toBe('served');
    expect(next.dishes.d3.location).toBe('cook');
  });

  it('sert un plat dressé et enregistre sa valeur', () => {
    const s = kitchen('free', [dish('d1', 'plate', { prep: 2, cook: 2, plate: 1 })], { a: 1, b: 1, c: 1 });
    const next = resolveTurn(s, brigade, { c: act({ d1: 1 }) }, cfg);
    expect(next.dishes.d1.location).toBe('served');
    expect(next.dishes.d1.value).toBe(20);
    expect(next.metrics[0].served).toBe(1);
  });

  it("fait partir un client dont la commande n'est jamais démarrée", () => {
    const s = { ...kitchen('free', [dish('d1', 'backlog')], { a: 1, b: 1, c: 1 }), turn: cfg.patience };
    const next = resolveTurn(s, brigade, {}, cfg);
    expect(next.dishes.d1.location).toBe('lost');
  });

  it("l'entraide n'est possible qu'au service 3, vers l'aval", () => {
    const d = dish('d1', 'cook', { prep: 2 });
    expect(targetKind(kitchen('limit', [d], {}), d, 'prep')).toBeNull();
    expect(targetKind(kitchen('swarm', [d], {}), d, 'prep')).toBe('help');
    expect(targetKind(kitchen('swarm', [d], {}), d, 'plate')).toBeNull();
    const s = kitchen('swarm', [d], { a: 2, b: 0, c: 0 });
    const next = resolveTurn(s, brigade, { a: act({ d1: 2 }) }, cfg);
    expect(next.dishes.d1.done.cook).toBe(2);
  });

  it('est déterministe pour un même état', () => {
    const s = newRound('free', brigade, cfg, 7);
    const a = resolveTurn(s, brigade, {}, cfg);
    const b = resolveTurn(s, brigade, {}, cfg);
    expect(a).toEqual(b);
  });

  it('ajoute des commandes VIP', () => {
    const s = addOrders(newRound('free', brigade, cfg, 1), 1, true);
    expect(Object.values(s.dishes).filter((d) => d.vip)).toHaveLength(1);
  });
});

function playRound(mode: RoundMode, seed: number, players = brigade) {
  let s = newRound(mode, players, cfg, seed);
  while (!isRoundOver(s, cfg)) {
    const actions: Record<string, PlayerAction> = {};
    const claimed = new Set<string>();
    for (const p of players) actions[p.uid] = act(botAllocation(s, p.station, s.rolls[p.uid], cfg, claimed));
    s = resolveTurn(s, players, actions, cfg);
  }
  return summarize(s);
}

describe('partie complète avec des robots', () => {
  it('les limites de WIP donnent de meilleurs résultats en moyenne', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
    const avg = (mode: RoundMode, key: 'served' | 'revenue' | 'avgCycle' | 'avgWip') =>
      seeds.reduce((s, seed) => s + playRound(mode, seed)[key], 0) / seeds.length;
    const free = { served: avg('free', 'served'), revenue: avg('free', 'revenue'), cycle: avg('free', 'avgCycle'), wip: avg('free', 'avgWip') };
    const limit = { served: avg('limit', 'served'), revenue: avg('limit', 'revenue'), cycle: avg('limit', 'avgCycle'), wip: avg('limit', 'avgWip') };
    const swarm = { served: avg('swarm', 'served'), revenue: avg('swarm', 'revenue'), cycle: avg('swarm', 'avgCycle'), wip: avg('swarm', 'avgWip') };
    console.log({ free, limit, swarm });
    expect(limit.revenue).toBeGreaterThan(free.revenue);
    expect(limit.cycle).toBeLessThan(free.cycle);
    expect(limit.wip).toBeLessThan(free.wip);
    expect(swarm.served).toBeGreaterThanOrEqual(limit.served * 0.95);
  });

  it('les limites gagnent aussi avec une grande brigade', () => {
    const big: PlayerInfo[] = ['prep', 'prep', 'prep', 'cook', 'cook', 'cook', 'plate', 'plate', 'plate'].map((s, i) => ({ uid: `p${i}`, station: s as StationId }));
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) if (playRound('limit', seed, big).revenue > playRound('free', seed, big).revenue) wins += 1;
    expect(wins).toBeGreaterThanOrEqual(27);
  });

  it('la limite grandit avec le nombre de cuisiniers', () => {
    const big: PlayerInfo[] = [{ uid: 'a', station: 'prep' }, { uid: 'b', station: 'cook' }, { uid: 'c', station: 'cook' }, { uid: 'd', station: 'cook' }, { uid: 'e', station: 'plate' }];
    expect(newRound('limit', big, cfg, 1).limits).toEqual({ prep: 2, cook: 4, plate: 2 });
  });
});
