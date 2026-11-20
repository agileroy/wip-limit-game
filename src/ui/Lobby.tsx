import { FormEvent, useState } from 'react';
import { STATION_LABEL, STATIONS, StationId } from '../engine/types';
import { joinRoom, Room, setStation } from '../room';
import { Crew } from './common';

const STATION_DESC: Record<StationId, string> = {
  prep: 'Tu tires les commandes de la salle et tu prépares les ingrédients.',
  cook: 'Tu prends les plats préparés et tu les cuis à point.',
  plate: 'Tu dresses l’assiette et tu l’envoies en salle.',
};

const PLAN: { label: string; duree: string; color: string; round?: number }[] = [
  { label: 'Briefing de la brigade', duree: '5 min', color: '#A8A196' },
  { label: 'Service 1 · sans limite', duree: '10 min', color: '#F97316', round: 0 },
  { label: 'Débrief à chaud', duree: '5 min', color: '#A8A196' },
  { label: 'Service 2 · limites de WIP', duree: '10 min', color: '#60A5FA', round: 1 },
  { label: 'Débrief à chaud', duree: '5 min', color: '#A8A196' },
  { label: 'Service 3 · limites + entraide', duree: '10 min', color: '#4ADE80', round: 2 },
  { label: 'Débrief à chaud', duree: '5 min', color: '#A8A196' },
  { label: 'Bilan : et chez nous ?', duree: '10 min', color: '#FFFFFF' },
];

export function SessionPlan({ current }: { current?: number }) {
  let t = 0;
  return (
    <section className="card dark stack">
      <div className="row spread">
        <h2>Déroulé</h2>
        <span className="mono small muted">60 min</span>
      </div>
      <ol className="timeline">
        {PLAN.map((p, i) => {
          const start = t;
          t += parseInt(p.duree, 10);
          return (
            <li key={i} className={p.round !== undefined && p.round === current ? 'current' : ''}>
              <span className="mono small muted" style={{ width: 44 }}>
                00:{String(start).padStart(2, '0')}
              </span>
              <span className="dot" style={{ background: p.color }} />
              <span className="grow">{p.label}</span>
              <span className="small muted">{p.duree}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Rules() {
  return (
    <section className="card stack">
      <h2>Les règles en 30 secondes</h2>
      <ol className="rules">
        <li>
          <span className="num">01</span>
          <strong>Lance ton dé</strong>
          <p>À chaque tour, ton dé te donne de 1 à 6 points de travail à placer sur les plats.</p>
        </li>
        <li>
          <span className="num">02</span>
          <strong>Chaque plat en plus coûte 1 point</strong>
          <p>Toucher plusieurs plats dans le même tour, c’est du changement de contexte : tu perds 1 point par plat supplémentaire.</p>
        </li>
        <li>
          <span className="num">03</span>
          <strong>Un plat entamé refroidit</strong>
          <p>Il vaut 20 € s’il sort vite, puis perd 2 € par tour. Une commande pas encore entamée ne perd rien, mais le client finit par partir.</p>
        </li>
      </ol>
    </section>
  );
}

export function NameForm({ room, uid }: { room: Room; uid: string }) {
  const [name, setName] = useState(() => localStorage.getItem('cdf-name') ?? '');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim().slice(0, 24);
    if (!n) return setError('Choisis un prénom ou un surnom.');
    try {
      localStorage.setItem('cdf-name', n);
    } catch {
      /* stockage indisponible */
    }
    try {
      await joinRoom(room.code, uid, n);
    } catch {
      setError('Impossible de rejoindre la salle.');
    }
  }
  return (
    <form className="card stack" onSubmit={submit} style={{ maxWidth: 520 }}>
      <h2>Comment t’appelles-tu en cuisine&nbsp;?</h2>
      <label className="field">
        Prénom ou surnom
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoFocus />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="btn accent" type="submit">
          Rejoindre la brigade
        </button>
      </div>
    </form>
  );
}

export function StationPicker({ room, uid }: { room: Room; uid: string }) {
  const mine = room.players[uid]?.station ?? null;
  return (
    <section className="card stack">
      <div className="row spread">
        <h2>Choisis ta station</h2>
        <span className="small muted">Répartissez-vous à peu près équitablement</span>
      </div>
      <div className="stations">
        {STATIONS.map((s) => {
          const crew = Object.entries(room.players).filter(([, p]) => p.station === s);
          const selected = mine === s;
          return (
            <button key={s} type="button" className={`station-card${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={() => setStation(room.code, uid, s)}>
              <div className="row spread">
                <h3>{STATION_LABEL[s]}</h3>
                {selected && <span className="pill" style={{ background: 'var(--accent)', color: '#fff' }}>Ta station</span>}
              </div>
              <span className="small" style={{ color: 'var(--ink-2)' }}>{STATION_DESC[s]}</span>
              <Crew players={crew} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
