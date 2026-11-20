import { get, onValue, ref, remove, set, update } from 'firebase/database';
import { useEffect, useState } from 'react';
import { botAllocation } from './engine/bots';
import { addOrders, hydrate, isRoundOver, newRound, resolveTurn, summarize } from './engine/engine';
import {
  DEFAULT_CONFIG,
  GameConfig,
  KitchenState,
  PlayerAction,
  PlayerInfo,
  ROUND_SEQUENCE,
  RoundSummary,
  StationId,
} from './engine/types';
import { db, serverNow } from './firebase';

export type GameStatus = 'lobby' | 'playing' | 'paused' | 'debrief' | 'finished';

export interface Player {
  name: string;
  station: StationId | null;
  joinedAt: number;
  bot?: boolean;
}

export interface GameNode {
  status: GameStatus;
  roundIndex: number;
  turnEndsAt: number;
  pausedRemaining: number;
  kitchen: KitchenState | null;
}

export interface Room {
  code: string;
  facilitator: string;
  createdAt: number;
  config: GameConfig;
  players: Record<string, Player>;
  game: GameNode;
  rounds: Record<string, RoundSummary>;
  actions: Record<string, Record<string, PlayerAction>>;
}

export const roundKey = (i: number) => `r${i}`;
export const turnKey = (round: number, turn: number) => `r${round}t${turn}`;

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function randomCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = '';
  for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
  return c + String(Math.floor(Math.random() * 90) + 10);
}

export function roomUrl(code: string): string {
  return `${location.origin}${location.pathname}#/r/${code}`;
}

// ---------- Lecture ----------

export function useRoom(code: string | null): { room: Room | null; loading: boolean; missing: boolean } {
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!code) return;
    setLoading(true);
    return onValue(
      ref(db, `rooms/${code}`),
      (snap) => {
        const v = snap.val();
        setLoading(false);
        if (!v || !v.facilitator) {
          setMissing(true);
          setRoom(null);
          return;
        }
        setMissing(false);
        setRoom({
          code,
          facilitator: v.facilitator,
          createdAt: v.createdAt ?? 0,
          config: { ...DEFAULT_CONFIG, ...(v.config ?? {}) },
          players: v.players ?? {},
          game: {
            status: v.game?.status ?? 'lobby',
            roundIndex: v.game?.roundIndex ?? 0,
            turnEndsAt: v.game?.turnEndsAt ?? 0,
            pausedRemaining: v.game?.pausedRemaining ?? 0,
            kitchen: v.game?.kitchen ? hydrate(v.game.kitchen) : null,
          },
          rounds: v.rounds ?? {},
          actions: v.actions ?? {},
        });
      },
      () => {
        setLoading(false);
        setMissing(true);
      },
    );
  }, [code]);
  return { room, loading, missing };
}

export function activePlayers(room: Room): PlayerInfo[] {
  return Object.entries(room.players)
    .filter(([, p]) => p.station)
    .map(([uid, p]) => ({ uid, station: p.station as StationId }));
}

export function staffing(room: Room): Record<StationId, number> {
  const out: Record<StationId, number> = { prep: 0, cook: 0, plate: 0 };
  for (const p of Object.values(room.players)) if (p.station) out[p.station] += 1;
  return out;
}

// ---------- Joueurs ----------

export async function createRoom(uid: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    try {
      await set(ref(db, `rooms/${code}/facilitator`), uid);
    } catch {
      continue; // code déjà pris
    }
    const game: GameNode = { status: 'lobby', roundIndex: 0, turnEndsAt: 0, pausedRemaining: 0, kitchen: null };
    await update(ref(db, `rooms/${code}`), { createdAt: serverNow(), config: DEFAULT_CONFIG, game });
    return code;
  }
  throw new Error('Impossible de créer une salle, réessaie.');
}

export async function roomExists(code: string): Promise<boolean> {
  const snap = await get(ref(db, `rooms/${code}/facilitator`));
  return snap.exists();
}

export async function joinRoom(code: string, uid: string, name: string): Promise<void> {
  const existing = await get(ref(db, `rooms/${code}/players/${uid}`));
  if (existing.exists()) {
    await update(ref(db, `rooms/${code}/players/${uid}`), { name });
    return;
  }
  await set(ref(db, `rooms/${code}/players/${uid}`), { name, station: null, joinedAt: serverNow() });
}

export function setStation(code: string, uid: string, station: StationId | null) {
  return update(ref(db, `rooms/${code}/players/${uid}`), { station });
}

export function removePlayer(code: string, uid: string) {
  return remove(ref(db, `rooms/${code}/players/${uid}`));
}

export function submitAction(room: Room, uid: string, action: PlayerAction) {
  const k = room.game.kitchen;
  if (!k) return Promise.resolve();
  return set(ref(db, `rooms/${room.code}/actions/${turnKey(room.game.roundIndex, k.turn)}/${uid}`), action);
}

// ---------- Animateur ----------

const BOT_NAMES = ['Robot Auguste', 'Robot Paul', 'Robot Ginette', 'Robot Anne-So', 'Robot Cyril', 'Robot Hélène'];

export function addBot(room: Room) {
  const counts = staffing(room);
  const station = (Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0]) as StationId;
  const n = Object.values(room.players).filter((p) => p.bot).length;
  const uid = `bot-${Date.now().toString(36)}`;
  return set(ref(db, `rooms/${room.code}/players/${uid}`), {
    name: BOT_NAMES[n % BOT_NAMES.length],
    station,
    bot: true,
    joinedAt: serverNow(),
  });
}

export function startRound(room: Room, roundIndex: number) {
  const mode = ROUND_SEQUENCE[roundIndex] ?? 'swarm';
  const kitchen = newRound(mode, activePlayers(room), room.config, Math.floor(Math.random() * 1e9));
  return update(ref(db, `rooms/${room.code}`), {
    actions: null,
    game: {
      status: 'playing',
      roundIndex,
      turnEndsAt: serverNow() + room.config.turnSeconds * 1000 + 2000,
      pausedRemaining: 0,
      kitchen,
    },
  });
}

export function pauseGame(room: Room) {
  return update(ref(db, `rooms/${room.code}/game`), {
    status: 'paused',
    pausedRemaining: Math.max(1000, room.game.turnEndsAt - serverNow()),
  });
}

export function resumeGame(room: Room) {
  return update(ref(db, `rooms/${room.code}/game`), {
    status: 'playing',
    turnEndsAt: serverNow() + room.game.pausedRemaining,
  });
}

export function addEvent(room: Room, kind: 'vip' | 'rush') {
  const k = room.game.kitchen;
  if (!k) return Promise.resolve();
  const next = kind === 'vip' ? addOrders(k, 1, true) : addOrders(k, 3, false);
  next.log = [...(k.log ?? []), kind === 'vip' ? 'Une table VIP vient d’arriver !' : 'Grande tablée : 3 commandes d’un coup !'];
  return update(ref(db, `rooms/${room.code}/game`), { kitchen: next });
}

/** Résout le tour courant. Appelé uniquement par l'écran animateur. */
export function resolveCurrentTurn(room: Room) {
  const k = room.game.kitchen;
  if (!k) return Promise.resolve();
  const players = activePlayers(room);
  const key = turnKey(room.game.roundIndex, k.turn);
  const actions: Record<string, PlayerAction> = { ...(room.actions[key] ?? {}) };
  // Les robots évitent les plats déjà choisis par les humains et par les autres robots
  const claimed = new Set<string>(Object.values(actions).flatMap((a) => Object.keys(a?.alloc ?? {})));
  for (const p of players) {
    if (room.players[p.uid]?.bot) {
      actions[p.uid] = { alloc: botAllocation(k, p.station, k.rolls[p.uid] ?? 0, room.config, claimed), submittedAt: 0, done: true };
    }
  }
  const next = resolveTurn(k, players, actions, room.config);
  const updates: Record<string, unknown> = {
    'game/kitchen': next,
    [`actions/${key}`]: null,
  };
  if (isRoundOver(next, room.config)) {
    updates['game/status'] = 'debrief';
    updates[`rounds/${roundKey(room.game.roundIndex)}`] = summarize(next);
  } else {
    updates['game/turnEndsAt'] = serverNow() + room.config.turnSeconds * 1000;
  }
  return update(ref(db, `rooms/${room.code}`), updates);
}

export function endRoundNow(room: Room) {
  const k = room.game.kitchen;
  if (!k) return Promise.resolve();
  return update(ref(db, `rooms/${room.code}`), {
    'game/status': 'debrief',
    [`rounds/${roundKey(room.game.roundIndex)}`]: summarize(k),
  });
}

export function finishGame(room: Room) {
  return update(ref(db, `rooms/${room.code}/game`), { status: 'finished' });
}

/** Retour à l'accueil pour réorganiser la brigade avant le service roundIndex. */
export function backToLobby(room: Room, roundIndex: number) {
  return update(ref(db, `rooms/${room.code}/game`), { status: 'lobby', roundIndex, kitchen: null });
}

export function resetGame(room: Room) {
  return update(ref(db, `rooms/${room.code}`), {
    rounds: null,
    actions: null,
    game: { status: 'lobby', roundIndex: 0, turnEndsAt: 0, pausedRemaining: 0, kitchen: null },
  });
}

export function saveConfig(room: Room, config: Partial<GameConfig>) {
  return update(ref(db, `rooms/${room.code}/config`), config);
}
