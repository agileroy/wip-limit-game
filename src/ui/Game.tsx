import { useEffect, useState } from 'react';
import { snapshot } from '../engine/engine';
import { Allocation, STATION_LABEL } from '../engine/types';
import { serverNow } from '../firebase';
import { formatCode, Room, submitAction, turnKey } from '../room';
import { Board, planStats } from './Board';
import { Brand, Crew, Die, formatSeconds, RoundPill, useCountdown } from './common';
import { Debrief } from './Debrief';
import { NameForm, Rules, SessionPlan, StationPicker } from './Lobby';

export function GameHeader({ room }: { room: Room }) {
  const k = room.game.kitchen;
  const playing = room.game.status === 'playing';
  const secs = useCountdown(room.game.turnEndsAt, playing, room.game.pausedRemaining);
  if (!k) return null;
  const turn = Math.min(k.turn, room.config.turnsPerRound);
  const m = snapshot(k, turn);
  return (
    <>
      <header className="topbar">
        <div className="row">
          <span className="brand-name">Coup de Feu</span>
          <RoundPill mode={k.mode} index={room.game.roundIndex} />
          <span className="small muted mono">Salle {formatCode(room.code)}</span>
        </div>
        <div className="row" style={{ gap: 20 }}>
          <span className="small">
            Tour <strong className="mono">{turn} / {room.config.turnsPerRound}</strong>
          </span>
          {room.game.status === 'paused' ? (
            <span className="pill" style={{ background: '#fde68a', color: 'var(--ink)' }}>En pause</span>
          ) : null}
          <span className={`timer${secs <= 5 && playing ? ' urgent' : ''}`} aria-live="off">
            {formatSeconds(secs)}
          </span>
        </div>
      </header>
      <div className="kpis">
        <div className="kpi"><span>Plats servis</span><strong>{m.served}</strong></div>
        <div className="kpi"><span>Recettes</span><strong>{m.revenue} €</strong></div>
        <div className="kpi"><span>Plats en cours</span><strong>{m.wip}</strong></div>
        <div className="kpi"><span>Clients partis</span><strong>{m.lost}</strong></div>
      </div>
    </>
  );
}

function bannerText(mode: string, roll: number, stats: ReturnType<typeof planStats>, load: number, limit: number, limited: boolean) {
  if (!roll) return { title: 'En attente du dé…', text: '' };
  const parts: string[] = [];
  if (stats.touched === 0) parts.push('Clique sur un plat de ta station, ou tire-en un depuis la colonne de gauche.');
  else if (stats.touched === 1) parts.push(`Un seul plat : aucun point perdu.`);
  else parts.push(`${stats.touched} plats touchés : ${stats.cost} point(s) perdu(s) en changement de contexte.`);
  if (limited && load >= limit) parts.push(`Ta station est pleine (${load}/${limit}) : finis avant de tirer.`);
  if (mode === 'swarm') parts.push('Tu peux aider les stations suivantes (bordure verte).');
  return {
    title: `Tu as fait ${roll}. Il te reste ${stats.left} point(s) à placer.`,
    text: parts.join(' '),
  };
}

function PlayingScreen({ room, uid }: { room: Room; uid: string }) {
  const k = room.game.kitchen!;
  const me = room.players[uid];
  const key = turnKey(room.game.roundIndex, k.turn);
  const remote = room.actions[key]?.[uid];
  const [plan, setPlan] = useState<Allocation>(remote?.alloc ?? {});
  const [locked, setLocked] = useState<boolean>(remote?.done ?? false);
  const [planKey, setPlanKey] = useState(key);

  useEffect(() => {
    if (planKey !== key) {
      setPlanKey(key);
      setPlan(room.actions[key]?.[uid]?.alloc ?? {});
      setLocked(room.actions[key]?.[uid]?.done ?? false);
    }
  }, [key, planKey, room.actions, uid]);

  const station = me?.station ?? null;
  const roll = station ? k.rolls[uid] ?? 0 : 0;
  const paused = room.game.status === 'paused';
  const stats = planStats(plan, roll, room.config);
  const limited = k.mode !== 'free';
  const load = station ? Object.values(k.dishes).filter((d) => d.location === station).length : 0;

  function update(next: Allocation, done = false) {
    setPlan(next);
    setLocked(done);
    void submitAction(room, uid, { alloc: next, submittedAt: serverNow(), done });
  }

  const doneUids = new Set(Object.entries(room.actions[key] ?? {}).filter(([, a]) => a.done).map(([u]) => u));
  for (const [u, p] of Object.entries(room.players)) if (p.bot) doneUids.add(u);
  const b = bannerText(k.mode, roll, stats, load, room.config.wipLimit, limited);

  return (
    <main className="page">
      <GameHeader room={room} />
      <Board
        kitchen={k}
        config={room.config}
        players={room.players}
        me={station ? { station, roll, plan, locked: locked || paused, onChange: (p) => update(p, false) } : undefined}
      />
      {station ? (
        <div className="turnbar">
          <div className={`banner ${k.mode}`}>
            <Die value={roll} rollKey={key} />
            <div className="stack" style={{ gap: 4 }}>
              <strong>{b.title}</strong>
              <span style={{ lineHeight: 1.45 }}>{b.text}</span>
            </div>
          </div>
          <div className="actions-col">
            {locked ? (
              <button className="btn ghost" type="button" onClick={() => update(plan, false)} disabled={paused}>
                Modifier mes points
              </button>
            ) : (
              <button className="btn" type="button" onClick={() => update(plan, true)} disabled={paused}>
                Valider mes points
              </button>
            )}
            <button className="btn soft" type="button" onClick={() => update({}, false)} disabled={locked || paused || !stats.touched}>
              Tout retirer
            </button>
            <span className="small muted">
              Tu es en {STATION_LABEL[station]}. Le tour se termine quand tout le monde a validé ou à la fin du chrono.
            </span>
          </div>
        </div>
      ) : (
        <p className="card">Tu n’as pas choisi de station avant le début du service : tu observes ce service. Tu pourras jouer au suivant.</p>
      )}
      <section className="stack">
        <span className="small muted">Brigade (en vert : a validé)</span>
        <Crew players={Object.entries(room.players).filter(([, p]) => p.station)} doneUids={doneUids} />
      </section>
    </main>
  );
}

export function PlayerView({ room, uid }: { room: Room; uid: string }) {
  const joined = !!room.players[uid];
  const status = room.game.status;

  if (!joined) {
    return (
      <main className="page">
        <Brand subtitle={`Salle ${formatCode(room.code)}`} />
        <NameForm room={room} uid={uid} />
      </main>
    );
  }

  if ((status === 'playing' || status === 'paused') && room.game.kitchen) return <PlayingScreen room={room} uid={uid} />;

  if (status === 'debrief' || status === 'finished') {
    return (
      <main className="page">
        <Brand subtitle={`Salle ${formatCode(room.code)}`} />
        <Debrief room={room} final={status === 'finished'} />
        {status === 'debrief' && <p className="small muted">L’animateur lancera le service suivant après la discussion.</p>}
      </main>
    );
  }

  return (
    <main className="page">
      <div className="row spread">
        <Brand subtitle="Le jeu qui montre pourquoi finir vaut mieux que commencer" />
        <span className="row small muted">
          Salle <span className="pill count">{formatCode(room.code)}</span>
        </span>
      </div>
      <section className="hero stack">
        <h1>Bienvenue en cuisine, {room.players[uid].name}.</h1>
        <p>Choisis ta station. L’animateur lancera le service quand toute la brigade sera là.</p>
      </section>
      <div className="layout">
        <div className="main">
          <StationPicker room={room} uid={uid} />
          <Rules />
        </div>
        <aside className="side">
          <SessionPlan current={room.game.roundIndex} />
        </aside>
      </div>
    </main>
  );
}
