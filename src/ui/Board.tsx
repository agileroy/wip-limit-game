import { currentValue, dishesAt, hasLimits, isReadyAt, stationLoad, targetKind, TargetKind, usefulPoints } from '../engine/engine';
import { Allocation, Dish, GameConfig, KitchenState, STATION_LABEL, STATIONS, StationId } from '../engine/types';
import { Player } from '../room';

export interface PlanApi {
  station: StationId;
  roll: number;
  plan: Allocation;
  locked: boolean;
  onChange: (plan: Allocation) => void;
}

interface Props {
  kitchen: KitchenState;
  config: GameConfig;
  players: Record<string, Player>;
  me?: PlanApi;
}

export function planStats(plan: Allocation, roll: number, cfg: GameConfig) {
  const touched = Object.values(plan).filter((v) => v > 0).length;
  const useful = usefulPoints(roll, touched, cfg);
  const used = Object.values(plan).reduce((s, v) => s + v, 0);
  return { touched, useful, used, left: Math.max(0, useful - used), cost: roll - useful };
}

export function Board({ kitchen, config, players, me }: Props) {
  const stats = me ? planStats(me.plan, me.roll, config) : null;
  const limited = hasLimits(kitchen.mode);

  const plannedPulls = me
    ? Object.keys(me.plan).filter((id) => kitchen.dishes[id] && kitchen.dishes[id].location !== me.station && targetKind(kitchen, kitchen.dishes[id], me.station) === 'pull').length
    : 0;

  function canAdd(dish: Dish, kind: TargetKind): boolean {
    if (!me || !stats || me.locked) return false;
    const already = me.plan[dish.id] ?? 0;
    if (already > 0) return stats.left > 0 && already < remainingFor(dish, kind, me.station);
    // nouveau plat : il faut qu'il reste au moins 1 point après le coût du changement de contexte
    const usefulNext = usefulPoints(me.roll, stats.touched + 1, config);
    if (usefulNext - stats.used < 1) return false;
    if (kind === 'pull' && limited && stationLoad(kitchen, me.station) + plannedPulls >= config.wipLimit) return false;
    return true;
  }

  function change(dish: Dish, delta: number) {
    if (!me) return;
    const next = { ...me.plan };
    const v = (next[dish.id] ?? 0) + delta;
    if (v <= 0) delete next[dish.id];
    else next[dish.id] = v;
    me.onChange(next);
  }

  const crewOf = (s: StationId) =>
    Object.values(players)
      .filter((p) => p.station === s)
      .map((p) => p.name)
      .join(', ') || 'Personne';

  const columns: { key: string; title: string; sub: string; station?: StationId; dishes: Dish[]; badge: string; full?: boolean }[] = [
    {
      key: 'backlog',
      title: 'Commandes',
      sub: 'Pas encore entamées : elles ne refroidissent pas',
      dishes: dishesAt(kitchen, 'backlog'),
      badge: String(dishesAt(kitchen, 'backlog').length),
    },
    ...STATIONS.map((s) => {
      const load = stationLoad(kitchen, s);
      return {
        key: s,
        title: STATION_LABEL[s],
        sub: crewOf(s),
        station: s,
        dishes: dishesAt(kitchen, s),
        badge: limited ? `${load} / ${config.wipLimit}` : String(load),
        full: limited && load >= config.wipLimit,
      };
    }),
  ];
  const served = dishesAt(kitchen, 'served').sort((a, b) => (b.finishedTurn ?? 0) - (a.finishedTurn ?? 0));
  const lost = dishesAt(kitchen, 'lost');
  const revenue = served.reduce((s, d) => s + (d.value ?? 0), 0);

  function renderTicket(dish: Dish, station?: StationId) {
    const kind = me ? targetKind(kitchen, dish, me.station) : null;
    const chosen = me?.plan[dish.id] ?? 0;
    const value = currentValue(dish, kitchen.turn, config);
    const base = dish.vip ? config.dishValue * 2 : config.dishValue;
    const cold = dish.startedTurn != null && value < base;
    const ready = station ? isReadyAt(dish, station) : false;
    const pipStation: StationId = station ?? 'prep';
    const plannedStation: StationId | null = kind === 'pull' ? (me?.station ?? null) : kind ? (dish.location as StationId) : null;
    const add = kind ? canAdd(dish, kind) : false;
    const clickable = !!kind && (add || chosen > 0);
    const age =
      dish.location === 'backlog'
        ? `Client patient encore ${Math.max(0, config.patience - (kitchen.turn - dish.arrivedTurn))} tour(s)`
        : ready
          ? 'Prêt pour la station suivante'
          : `Entamé il y a ${kitchen.turn - (dish.startedTurn ?? kitchen.turn)} tour(s)`;
    const kindLabel = kind === 'pull' ? 'Tirer' : kind === 'help' ? 'Aider' : '';

    const pipsFor = (s: StationId) => {
      const planned = plannedStation === s ? chosen : 0;
      return Array.from({ length: dish.work[s] }, (_, i) => {
        const cls = i < dish.done[s] ? 'on' : i < dish.done[s] + planned ? 'plan' : '';
        return <span key={i} className={`pip ${cls}`} />;
      });
    };

    const className = [
      'ticket',
      cold ? 'cold' : '',
      ready ? 'ready' : '',
      dish.vip ? 'vip' : '',
      clickable ? `target ${kind}` : '',
      chosen ? 'chosen' : '',
      kind && !clickable && !chosen ? 'blocked' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const body = (
      <>
        {chosen > 0 && <span className="chip-alloc">+{chosen}</span>}
        <div className="ticket-top">
          <span className="mono muted">#{dish.id.slice(1).padStart(2, '0')}{dish.vip ? ' · VIP' : ''}</span>
          <span className={`value${cold ? ' cold' : ''}`}>{value} €</span>
        </div>
        <span className="ticket-name">{dish.recipe}</span>
        <div className="pips" role="img" aria-label={`${STATION_LABEL[pipStation]} : ${dish.done[pipStation]} sur ${dish.work[pipStation]}`}>
          {pipsFor(plannedStation ?? pipStation)}
        </div>
        <div className="ticket-foot">
          <span>{age}</span>
          {kindLabel && clickable && !chosen && <strong>{kindLabel}</strong>}
        </div>
      </>
    );

    if (!me || !kind) {
      return (
        <article key={dish.id} className={className}>
          {body}
        </article>
      );
    }
    return (
      <div key={dish.id} className={className} style={{ padding: 0 }}>
        <button
          type="button"
          className="ticket-btn"
          disabled={!add}
          onClick={() => change(dish, 1)}
          aria-label={`${kindLabel || 'Travailler'} : ${dish.recipe}, ajouter 1 point`}
        >
          {body}
        </button>
        {chosen > 0 && (
          <div className="stepper" style={{ padding: '0 12px 10px' }}>
            <button type="button" onClick={() => change(dish, -1)} disabled={me.locked} aria-label={`Retirer 1 point de ${dish.recipe}`}>
              −
            </button>
            <span className="mono small">{chosen} pt</span>
            <button type="button" onClick={() => change(dish, 1)} disabled={!add} aria-label={`Ajouter 1 point à ${dish.recipe}`}>
              +
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="board-scroll">
      <div className="board">
        {columns.map((col) => {
          const mine = me && col.station === me.station;
          const helpable = me && kitchen.mode === 'swarm' && col.station && STATIONS.indexOf(col.station) > STATIONS.indexOf(me.station);
          const inProgress = col.station ? col.dishes.filter((d) => !isReadyAt(d, col.station!)) : col.dishes;
          const readyList = col.station ? col.dishes.filter((d) => isReadyAt(d, col.station!)) : [];
          return (
            <section key={col.key} className={`col${mine ? ' mine' : ''}${helpable ? ' helpable' : ''}`} aria-label={col.title}>
              <div className="col-head">
                <div>
                  <h2>{col.title}</h2>
                  <div className="col-sub">{mine ? `Ta station · ${col.sub}` : col.sub}</div>
                </div>
                <span className={`pill ${col.full ? 'full' : 'count'}`}>{col.badge}</span>
              </div>
              {inProgress.map((d) => renderTicket(d, col.station))}
              {readyList.length > 0 && <div className="col-section">Prêts</div>}
              {readyList.map((d) => renderTicket(d, col.station))}
              {col.dishes.length === 0 && <div className="empty">Rien ici</div>}
            </section>
          );
        })}
        <section className="col" aria-label="Servi">
          <div className="col-head">
            <div>
              <h2>Servi</h2>
              <div className="col-sub">
                {served.length} plat(s){lost.length ? ` · ${lost.length} client(s) parti(s)` : ''}
              </div>
            </div>
            <span className="pill count">{revenue} €</span>
          </div>
          {served.slice(0, 6).map((d) => (
            <article key={d.id} className="ticket">
              <div className="ticket-top">
                <span className="mono muted">#{d.id.slice(1).padStart(2, '0')}</span>
                <span className="value served">{d.value} €</span>
              </div>
              <span className="ticket-name">{d.recipe}</span>
              <div className="ticket-foot">
                <span>Servi en {(d.finishedTurn ?? 0) - (d.startedTurn ?? 0) + 1} tour(s)</span>
              </div>
            </article>
          ))}
          {served.length > 6 && <div className="small muted">et {served.length - 6} autre(s)</div>}
          {served.length === 0 && <div className="empty">Aucun plat servi</div>}
        </section>
      </div>
    </div>
  );
}

function remainingFor(dish: Dish, kind: TargetKind, station: StationId): number {
  const s: StationId = kind === 'pull' ? station : (dish.location as StationId);
  return dish.work[s] - dish.done[s];
}
