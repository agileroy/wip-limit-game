export type StationId = 'prep' | 'cook' | 'plate';
export const STATIONS: StationId[] = ['prep', 'cook', 'plate'];

export const STATION_LABEL: Record<StationId, string> = {
  prep: 'Préparation',
  cook: 'Cuisson',
  plate: 'Dressage',
};

/** free = sans limite, limit = limites de WIP, swarm = limites + entraide vers l'aval */
export type RoundMode = 'free' | 'limit' | 'swarm';

export const ROUND_SEQUENCE: RoundMode[] = ['free', 'limit', 'swarm'];

export const ROUND_LABEL: Record<RoundMode, string> = {
  free: 'Sans limite',
  limit: 'Limites de WIP',
  swarm: 'Limites + entraide',
};

export interface GameConfig {
  turnsPerRound: number;
  turnSeconds: number;
  /** nombre max de plats par station (en cours + prêts) */
  wipLimit: number;
  /** valeur d'un plat servi chaud */
  dishValue: number;
  /** perte de valeur par tour une fois le délai de grâce passé */
  decayPerTurn: number;
  /** nombre de tours après le démarrage pendant lesquels le plat reste chaud */
  coolGrace: number;
  /** points perdus par plat supplémentaire touché dans un tour */
  contextSwitchCost: number;
  /** nombre de tours qu'un client attend avant de partir si sa commande n'est pas démarrée */
  patience: number;
  /** commandes attendues par tour pour une brigade complète (1 joueur par station) */
  arrivalsPerBrigade: number;
  /** commandes déjà en file au début d'un service */
  initialOrders: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  turnsPerRound: 15,
  turnSeconds: 30,
  wipLimit: 2,
  dishValue: 20,
  decayPerTurn: 2,
  coolGrace: 3,
  contextSwitchCost: 1,
  patience: 6,
  arrivalsPerBrigade: 0.85,
  initialOrders: 3,
};

export type DishLocation = 'backlog' | StationId | 'served' | 'lost';

export interface Dish {
  id: string;
  recipe: string;
  work: Record<StationId, number>;
  done: Record<StationId, number>;
  location: DishLocation;
  arrivedTurn: number;
  startedTurn: number | null;
  finishedTurn: number | null;
  value: number | null;
  vip: boolean;
}

export interface PlayerInfo {
  uid: string;
  station: StationId;
}

/** Points alloués par un joueur : id du plat -> points */
export type Allocation = Record<string, number>;

export interface PlayerAction {
  alloc: Allocation;
  submittedAt: number;
  done: boolean;
}

export interface TurnMetric {
  turn: number;
  wip: number;
  served: number;
  revenue: number;
  lost: number;
}

export interface KitchenState {
  mode: RoundMode;
  /** tour courant, de 1 à turnsPerRound */
  turn: number;
  dishes: Record<string, Dish>;
  nextDishId: number;
  rolls: Record<string, number>;
  rng: number;
  arrivalAcc: number;
  metrics: TurnMetric[];
  /** points de travail perdus (changement de contexte, limites, surplus) */
  wasted: number;
  /** journal du dernier tour, pour l'affichage */
  log: string[];
}

export interface RoundSummary {
  mode: RoundMode;
  served: number;
  revenue: number;
  lost: number;
  avgWip: number;
  avgCycle: number;
  throughput: number;
  wasted: number;
  metrics: TurnMetric[];
}
