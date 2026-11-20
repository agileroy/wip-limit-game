import { useEffect, useRef, useState } from 'react';
import { ROUND_LABEL, RoundMode } from '../engine/types';
import { serverNow } from '../firebase';
import { Player } from '../room';

export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <div className="brand">
      <div className="brand-mark">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z" />
          <path d="M5 21h14" />
        </svg>
      </div>
      <div>
        <div className="brand-name">Rush en cuisine</div>
        {subtitle && <div className="small muted">{subtitle}</div>}
      </div>
    </div>
  );
}

const FACES: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Dé animé : rejoue l'animation à chaque changement de rollKey. */
export function Die({ value, rollKey, small }: { value: number; rollKey: string; small?: boolean }) {
  const [shown, setShown] = useState(value);
  const [rolling, setRolling] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (first.current && small) {
      first.current = false;
      setShown(value);
      return;
    }
    first.current = false;
    if (reduced || !value) {
      setShown(value);
      return;
    }
    setRolling(true);
    const iv = setInterval(() => setShown(1 + Math.floor(Math.random() * 6)), 90);
    const to = setTimeout(() => {
      clearInterval(iv);
      setShown(value);
      setRolling(false);
    }, 900);
    return () => {
      clearInterval(iv);
      clearTimeout(to);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey]);
  useEffect(() => {
    if (!rolling) setShown(value);
  }, [value, rolling]);
  const on = FACES[shown] ?? [];
  return (
    <div className="die-wrap" role="img" aria-label={value ? `Dé : ${value}` : 'Dé pas encore lancé'}>
      <div className={`die${rolling ? ' rolling' : ''}${small ? ' small' : ''}`}>
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={on.includes(i) ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}

export function useCountdown(endsAt: number, active: boolean, frozenMs = 0): number {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(iv);
  }, [active]);
  if (!active) return Math.ceil(frozenMs / 1000);
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function RoundPill({ mode, index }: { mode: RoundMode; index: number }) {
  return (
    <span className={`pill ${mode}`}>
      Service {index + 1} · {ROUND_LABEL[mode]}
    </span>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

export function Crew({ players, doneUids }: { players: [string, Player][]; doneUids?: Set<string> }) {
  if (!players.length) return <span className="small muted">Personne pour l'instant</span>;
  return (
    <div className="crew">
      {players.map(([uid, p]) => (
        <span key={uid} className={`crew-member${doneUids?.has(uid) ? ' done' : ''}`}>
          <span className="avatar" aria-hidden="true">{initials(p.name)}</span>
          {p.name}
          {doneUids?.has(uid) && <span className="sr-only"> (a validé)</span>}
        </span>
      ))}
    </div>
  );
}

export const MODE_COLOR: Record<RoundMode, string> = {
  free: '#EA580C',
  limit: '#1D4ED8',
  swarm: '#15803D',
};
