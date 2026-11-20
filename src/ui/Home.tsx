import { FormEvent, useState } from 'react';
import { createRoom, normalizeCode, roomExists } from '../room';
import { Brand } from './common';
import { SessionPlan } from './Lobby';

export function Home({ uid, initialCode, go }: { uid: string; initialCode?: string; go: (hash: string) => void }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function join(e: FormEvent) {
    e.preventDefault();
    const c = normalizeCode(code);
    if (!c) return setError('Saisis le code donné par ton animateur.');
    setBusy(true);
    setError('');
    try {
      if (!(await roomExists(c))) setError('Cette salle n’existe pas. Vérifie le code.');
      else go(`/r/${c}`);
    } catch {
      setError('Connexion impossible. Réessaie dans un instant.');
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError('');
    try {
      const c = await createRoom(uid);
      go(`/a/${c}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible.');
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Brand subtitle="Le jeu qui montre pourquoi finir vaut mieux que commencer" />
      <section className="hero stack">
        <h1>
          Une cuisine, trois services,
          <br />
          une seule question : combien de plats en même temps&nbsp;?
        </h1>
        <p>
          Votre brigade doit envoyer un maximum de plats chauds. Mêmes cuisiniers, mêmes recettes : seules les règles de la cuisine changent d’un
          service à l’autre. À la fin, vos propres chiffres racontent pourquoi limiter le travail en cours fait aller plus vite.
        </p>
      </section>
      <div className="layout">
        <div className="main">
          <form className="card stack" onSubmit={join}>
            <h2>Rejoindre une partie</h2>
            <label className="field">
              Code de la salle
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ABCD-42"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={8}
                className="mono"
              />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="row">
              <button className="btn accent" type="submit" disabled={busy}>
                Entrer en cuisine
              </button>
            </div>
          </form>
          <section className="card stack">
            <h2>Tu animes la session&nbsp;?</h2>
            <p className="muted" style={{ margin: 0 }}>
              Crée une salle, partage le lien à l’équipe et pilote les trois services depuis la table animateur. Prévois 60 minutes, de 3 à 9
              joueurs. Tu peux compléter la brigade avec des robots pour tester seul.
            </p>
            <div className="row">
              <button className="btn" type="button" onClick={create} disabled={busy}>
                Créer une salle
              </button>
            </div>
          </section>
        </div>
        <aside className="side">
          <SessionPlan />
        </aside>
      </div>
    </main>
  );
}
