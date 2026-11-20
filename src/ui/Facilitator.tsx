import { useEffect, useRef, useState } from 'react';
import { ROUND_LABEL, ROUND_SEQUENCE, STATION_LABEL, STATIONS, StationId } from '../engine/types';
import { serverNow } from '../firebase';
import {
  activePlayers,
  addBot,
  addEvent,
  backToLobby,
  endRoundNow,
  finishGame,
  formatCode,
  pauseGame,
  removePlayer,
  resetGame,
  resolveCurrentTurn,
  resumeGame,
  Room,
  roomUrl,
  saveConfig,
  setStation,
  staffing,
  startRound,
  turnKey,
} from '../room';
import { Board } from './Board';
import { Brand, Crew } from './common';
import { Debrief } from './Debrief';
import { GameHeader } from './Game';
import { SessionPlan } from './Lobby';

/** Boucle de l'animateur : c'est son navigateur qui fait avancer les tours. */
function useTurnEngine(room: Room) {
  const roomRef = useRef(room);
  roomRef.current = room;
  const resolving = useRef<string | null>(null);
  useEffect(() => {
    const iv = setInterval(() => {
      const r = roomRef.current;
      const k = r.game.kitchen;
      if (r.game.status !== 'playing' || !k) return;
      const key = turnKey(r.game.roundIndex, k.turn);
      if (resolving.current === key) return;
      const humans = activePlayers(r).filter((p) => !r.players[p.uid]?.bot);
      const acts = r.actions[key] ?? {};
      const allDone = humans.length > 0 && humans.every((p) => acts[p.uid]?.done);
      const timeUp = serverNow() >= r.game.turnEndsAt;
      if (!allDone && !timeUp) return;
      resolving.current = key;
      resolveCurrentTurn(r).catch(() => {
        resolving.current = null;
      });
    }, 400);
    return () => clearInterval(iv);
  }, []);
}

function Lobby({ room }: { room: Room }) {
  const [copied, setCopied] = useState(false);
  const counts = staffing(room);
  const ready = STATIONS.every((s) => counts[s] > 0);
  const unassigned = Object.entries(room.players).filter(([, p]) => !p.station);
  const url = roomUrl(room.code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* presse-papiers indisponible */
    }
  }

  return (
    <div className="layout">
      <div className="main">
        <section className="card stack">
          <span className="small muted">Code de la salle</span>
          <span className="code-big">{formatCode(room.code)}</span>
          <div className="row">
            <code className="small" style={{ wordBreak: 'break-all' }}>{url}</code>
            <button className="btn small soft" type="button" onClick={copy}>
              {copied ? 'Lien copié' : 'Copier le lien'}
            </button>
          </div>
          <span className="small muted">Partage ce lien dans la visio. Chacun choisit son prénom et sa station.</span>
        </section>

        <section className="card stack">
          <div className="row spread">
            <h2>La brigade</h2>
            <button className="btn small ghost" type="button" onClick={() => addBot(room)}>
              Ajouter un robot cuisinier
            </button>
          </div>
          {STATIONS.map((s) => (
            <div key={s} className="stack" style={{ gap: 6 }}>
              <strong>{STATION_LABEL[s]} · {counts[s]}</strong>
              <PlayerRows room={room} entries={Object.entries(room.players).filter(([, p]) => p.station === s)} />
            </div>
          ))}
          {unassigned.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <strong>Sans station · {unassigned.length}</strong>
              <PlayerRows room={room} entries={unassigned} />
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Les robots jouent « tout démarrer » au service 1 puis « finir avant de commencer » ensuite. Pratique pour tester seul ou compléter une
            station vide.
          </p>
        </section>

        <section className="card stack">
          <h2>Réglages</h2>
          <div className="row">
            <label className="field">
              Durée d’un tour (s)
              <select value={room.config.turnSeconds} onChange={(e) => saveConfig(room, { turnSeconds: Number(e.target.value) })}>
                {[20, 25, 30, 35, 40, 45].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="field">
              Tours par service
              <select value={room.config.turnsPerRound} onChange={(e) => saveConfig(room, { turnsPerRound: Number(e.target.value) })}>
                {[10, 12, 15, 18].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="field">
              Limite par station
              <select value={room.config.wipLimit} onChange={(e) => saveConfig(room, { wipLimit: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          </div>
        </section>
      </div>
      <aside className="side">
        <section className="card stack">
          <h2>Prochaine étape</h2>
          <p style={{ margin: 0 }}>
            Service {room.game.roundIndex + 1} · {ROUND_LABEL[ROUND_SEQUENCE[room.game.roundIndex] ?? 'swarm']}
          </p>
          {!ready && <p className="small error" style={{ margin: 0 }}>Il faut au moins une personne (ou un robot) par station.</p>}
          <button className="btn accent" type="button" disabled={!ready} onClick={() => startRound(room, room.game.roundIndex)}>
            Lancer le service {room.game.roundIndex + 1}
          </button>
        </section>
        <SessionPlan current={room.game.roundIndex} />
      </aside>
    </div>
  );
}

function PlayerRows({ room, entries }: { room: Room; entries: [string, Room['players'][string]][] }) {
  if (!entries.length) return <span className="small muted">Personne</span>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(([uid, p]) => (
        <li key={uid} className="row" style={{ gap: 8 }}>
          <span className="grow">{p.name}{p.bot ? ' 🤖' : ''}</span>
          <label className="sr-only" htmlFor={`st-${uid}`}>Station de {p.name}</label>
          <select
            id={`st-${uid}`}
            value={p.station ?? ''}
            onChange={(e) => setStation(room.code, uid, (e.target.value || null) as StationId | null)}
            style={{ border: '1px solid var(--line-2)', borderRadius: 8, padding: '6px 8px' }}
          >
            <option value="">Sans station</option>
            {STATIONS.map((s) => <option key={s} value={s}>{STATION_LABEL[s]}</option>)}
          </select>
          <button className="btn small soft" type="button" onClick={() => removePlayer(room.code, uid)} aria-label={`Retirer ${p.name}`}>
            Retirer
          </button>
        </li>
      ))}
    </ul>
  );
}

function Playing({ room }: { room: Room }) {
  const k = room.game.kitchen!;
  const key = turnKey(room.game.roundIndex, k.turn);
  const acts = room.actions[key] ?? {};
  const done = new Set(Object.entries(acts).filter(([, a]) => a.done).map(([u]) => u));
  for (const [u, p] of Object.entries(room.players)) if (p.bot) done.add(u);
  const paused = room.game.status === 'paused';
  return (
    <>
      <GameHeader room={room} />
      <section className="card stack">
        <div className="row spread">
          <h2 style={{ fontSize: 20 }}>Table animateur</h2>
          <span className="small muted">
            {done.size} / {activePlayers(room).length} ont validé
          </span>
        </div>
        <div className="facil-controls">
          {paused ? (
            <button className="btn accent" type="button" onClick={() => resumeGame(room)}>Reprendre</button>
          ) : (
            <button className="btn" type="button" onClick={() => pauseGame(room)}>Pause</button>
          )}
          <button className="btn ghost" type="button" onClick={() => resolveCurrentTurn(room)} disabled={paused}>
            Passer au tour suivant
          </button>
          <button className="btn ghost" type="button" onClick={() => addEvent(room, 'vip')}>
            Événement : table VIP
          </button>
          <button className="btn ghost" type="button" onClick={() => addEvent(room, 'rush')}>
            Événement : coup de feu (+3 commandes)
          </button>
          <button className="btn soft" type="button" onClick={() => endRoundNow(room)}>
            Terminer le service
          </button>
        </div>
        <Crew players={Object.entries(room.players).filter(([, p]) => p.station)} doneUids={done} />
        {k.log.length > 0 && (
          <div className="log" aria-live="polite">
            {k.log.slice(-4).map((l, i) => <span key={i}>{l}</span>)}
          </div>
        )}
      </section>
      <Board kitchen={k} config={room.config} players={room.players} />
    </>
  );
}

export function FacilitatorView({ room, uid }: { room: Room; uid: string }) {
  useTurnEngine(room);
  if (room.facilitator !== uid) {
    return (
      <main className="page">
        <Brand />
        <p className="card">Cette table animateur appartient à un autre navigateur. Rejoins la partie comme joueur avec le code {formatCode(room.code)}.</p>
      </main>
    );
  }
  const status = room.game.status;
  const next = room.game.roundIndex + 1;
  return (
    <main className="page">
      {(status === 'lobby') && (
        <>
          <div className="row spread">
            <Brand subtitle="Table animateur" />
          </div>
          <Lobby room={room} />
        </>
      )}
      {(status === 'playing' || status === 'paused') && room.game.kitchen && <Playing room={room} />}
      {(status === 'debrief' || status === 'finished') && (
        <>
          <div className="row spread">
            <Brand subtitle="Table animateur" />
            <div className="row">
              {status === 'debrief' && next < ROUND_SEQUENCE.length && (
                <>
                  <button className="btn ghost" type="button" onClick={() => backToLobby(room, next)}>
                    Modifier la brigade
                  </button>
                  <button className="btn accent" type="button" onClick={() => startRound(room, next)}>
                    Lancer le service {next + 1} · {ROUND_LABEL[ROUND_SEQUENCE[next]]}
                  </button>
                </>
              )}
              {status === 'debrief' && next >= ROUND_SEQUENCE.length && (
                <button className="btn accent" type="button" onClick={() => finishGame(room)}>
                  Afficher le bilan final
                </button>
              )}
              {status === 'finished' && (
                <button className="btn ghost" type="button" onClick={() => resetGame(room)}>
                  Nouvelle partie avec la même brigade
                </button>
              )}
            </div>
          </div>
          <Debrief room={room} final={status === 'finished'} />
        </>
      )}
    </main>
  );
}

