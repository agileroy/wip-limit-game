import { ROUND_LABEL, ROUND_SEQUENCE, RoundSummary, TurnMetric } from '../engine/types';
import { Room, roundKey } from '../room';
import { MODE_COLOR } from './common';

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

function LineChart({ title, caption, series, pick, turns }: {
  title: string;
  caption: string;
  series: { label: string; color: string; dashed?: boolean; metrics: TurnMetric[] }[];
  pick: (m: TurnMetric) => number;
  turns: number;
}) {
  const W = 720, H = 260, L = 40, R = 140, T = 20, B = 36;
  const max = Math.max(4, ...series.flatMap((s) => s.metrics.map(pick)));
  const top = Math.ceil(max / 4) * 4;
  const x = (turn: number) => L + ((turn) / turns) * (W - L - R);
  const y = (v: number) => H - B - (v / top) * (H - T - B);
  const ticks = [0, top / 4, top / 2, (3 * top) / 4, top];
  const label = series.map((s) => `${s.label} : ${s.metrics.length ? pick(s.metrics[s.metrics.length - 1]) : 0}`).join(', ');
  // Étiquettes de fin de courbe sans chevauchement
  const ends = series
    .map((s) => ({ s, v: s.metrics.length ? pick(s.metrics[s.metrics.length - 1]) : 0 }))
    .sort((a, b) => b.v - a.v);
  let lastY = -Infinity;
  const endY = new Map<string, number>();
  for (const e of ends) {
    let yy = y(e.v) + 4;
    if (yy - lastY < 16) yy = lastY + 16;
    endY.set(e.s.label, yy);
    lastY = yy;
  }
  return (
    <section className="card stack chart">
      <h2 style={{ fontSize: 20 }}>{title}</h2>
      <span className="small muted">{caption}</span>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${label}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#ECE7DD" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#5F5A52">{fmt(t)}</text>
          </g>
        ))}
        {[0, Math.round(turns / 2), turns].map((t) => (
          <text key={t} x={x(t)} y={H - 12} textAnchor="middle" fontSize="12" fill="#5F5A52">
            {t === 0 ? 'tour 0' : `tour ${t}`}
          </text>
        ))}
        {series.map((s) => {
          const pts = [[0, 0], ...s.metrics.map((m) => [m.turn, pick(m)])].map(([t, v]) => `${x(t)},${y(v)}`).join(' ');
          return (
            <g key={s.label}>
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="3" strokeLinejoin="round" strokeDasharray={s.dashed ? '6 5' : undefined} />
              <text x={W - R + 10} y={endY.get(s.label)} fontSize="13" fontWeight="600" fill={s.color}>
                {s.label} · {s.metrics.length ? pick(s.metrics[s.metrics.length - 1]) : 0}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

const QUESTIONS: Record<number, string[]> = {
  0: [
    'Qu’est-ce qui vous poussait à prendre un plat de plus ?',
    'Qu’avez-vous ressenti en voyant les plats refroidir ?',
    'Où les plats s’empilaient-ils ? Pourquoi là ?',
  ],
  1: [
    'Qu’avez-vous ressenti quand la limite vous a empêché de démarrer ?',
    'Qu’est-ce qui a changé dans les chiffres ? Et dans l’ambiance ?',
    'Que faisiez-vous quand votre station était pleine ?',
  ],
  2: [
    'Qu’a changé le droit d’aider la station suivante ?',
    'Qui a aidé qui ? Comment l’avez-vous décidé ?',
    'Lequel des trois services ressemble le plus à notre quotidien ?',
  ],
  3: [
    'Combien de tickets sont « en cours » dans notre équipe aujourd’hui ? Combien par personne ?',
    'Quelle limite essayons-nous dès lundi, et sur quelle colonne ?',
    'Que fait-on quand la limite est atteinte ? Qui aide qui ?',
  ],
};

export function Debrief({ room, final }: { room: Room; final?: boolean }) {
  const rounds = ROUND_SEQUENCE.map((_, i) => room.rounds[roundKey(i)]).filter(Boolean) as RoundSummary[];
  const turns = room.config.turnsPerRound;
  const series = rounds.map((r, i) => ({
    label: `Service ${i + 1}`,
    color: MODE_COLOR[r.mode],
    dashed: r.mode === 'free',
    metrics: r.metrics ?? [],
  }));
  const qKey = final ? 3 : Math.min(2, rounds.length - 1);
  const best = rounds.length > 1 ? rounds[rounds.length - 1] : null;
  const first = rounds[0];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <header className="stack" style={{ gap: 6 }}>
        <span className="small" style={{ color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {final ? 'Bilan des services' : `Débrief du service ${rounds.length}`}
        </span>
        <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.05 }}>
          {best && first && best.served > first.served
            ? `Même brigade, mêmes dés : ${best.served} plats servis au lieu de ${first.served}.`
            : 'Que s’est-il passé dans la cuisine ?'}
        </h1>
      </header>

      <div className="round-cards">
        {rounds.map((r, i) => (
          <section key={i} className="card round-card" style={{ borderTopColor: MODE_COLOR[r.mode] }}>
            <h2 style={{ fontSize: 20 }}>Service {i + 1}</h2>
            <span className="small muted">{ROUND_LABEL[r.mode]}</span>
            <dl className="stats">
              <div><dt>Plats servis</dt><dd>{r.served}</dd></div>
              <div><dt>Recettes</dt><dd>{r.revenue} €</dd></div>
              <div><dt>Plats en cours (moy.)</dt><dd>{fmt(r.avgWip)}</dd></div>
              <div><dt>Temps de traversée</dt><dd>{fmt(r.avgCycle)} tours</dd></div>
              <div><dt>Clients partis</dt><dd>{r.lost}</dd></div>
              <div><dt>Points perdus</dt><dd>{r.wasted}</dd></div>
            </dl>
          </section>
        ))}
      </div>

      <div className="layout">
        <div className="main">
          <LineChart
            title="Plats servis, tour après tour"
            caption="Plus la courbe monte tôt, plus vite la valeur arrive au client."
            series={series}
            pick={(m) => m.served}
            turns={turns}
          />
          <LineChart
            title="Plats en cours, tour après tour"
            caption="Le travail commencé mais pas fini : c’est lui qui refroidit."
            series={series}
            pick={(m) => m.wip}
            turns={turns}
          />
        </div>
        <aside className="side">
          <section className="card dark stack">
            <h2 style={{ fontSize: 20 }}>Ce que la cuisine nous apprend</h2>
            <p style={{ margin: 0, lineHeight: 1.5 }}>
              Le temps qu’un plat met à traverser la cuisine suit le nombre de plats en cours (loi de Little) : moins de plats en cours, c’est des
              plats qui sortent plus vite.
            </p>
            <p style={{ margin: 0, lineHeight: 1.5 }}>
              Jongler entre plusieurs plats coûte des points à chaque tour : c’est le prix caché du changement de contexte.
            </p>
            <p style={{ margin: 0, lineHeight: 1.5 }}>
              La limite ne ralentit pas : elle rend le goulot visible. L’entraide le résorbe.
            </p>
          </section>
          <section className="card stack">
            <h2 style={{ fontSize: 20 }}>{final ? 'Et chez nous ?' : 'À discuter maintenant'}</h2>
            <ol className="questions" style={{ gridTemplateColumns: '1fr' }}>
              {QUESTIONS[qKey].map((q, i) => (
                <li key={i}>
                  <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>{String(i + 1).padStart(2, '0')}</span>
                  <span>{q}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
