import { useEffect, useState } from 'react';
import { ensureSignedIn } from './firebase';
import { normalizeCode, useRoom } from './room';
import { Brand } from './ui/common';
import { FacilitatorView } from './ui/Facilitator';
import { PlayerView } from './ui/Game';
import { Home } from './ui/Home';

function useHashRoute(): [string, (h: string) => void] {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (h: string) => { window.location.hash = h; }];
}

function RoomRoute({ code, uid, facilitator, go }: { code: string; uid: string; facilitator: boolean; go: (h: string) => void }) {
  const { room, loading, missing } = useRoom(code);
  if (loading) return <Centered>Connexion à la cuisine…</Centered>;
  if (missing || !room) {
    return (
      <Centered>
        <p>Cette salle n’existe pas ou plus.</p>
        <button className="btn" type="button" onClick={() => go('/')}>Retour à l’accueil</button>
      </Centered>
    );
  }
  return facilitator ? <FacilitatorView room={room} uid={uid} /> : <PlayerView room={room} uid={uid} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="page">
      <Brand />
      <div className="card stack" style={{ maxWidth: 520 }}>{children}</div>
    </main>
  );
}

export function App() {
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [route, go] = useHashRoute();

  useEffect(() => {
    ensureSignedIn()
      .then((u) => setUid(u.uid))
      .catch(() => setError('Impossible de se connecter au serveur du jeu. Vérifie ta connexion puis recharge la page.'));
  }, []);

  if (error) return <Centered><p className="error">{error}</p></Centered>;
  if (!uid) return <Centered>Ouverture de la cuisine…</Centered>;

  const m = route.match(/^\/(r|a)\/([A-Za-z0-9-]+)/);
  if (m) return <RoomRoute key={route} code={normalizeCode(m[2])} uid={uid} facilitator={m[1] === 'a'} go={go} />;
  const join = route.match(/^\/join\/([A-Za-z0-9-]+)/);
  return <Home uid={uid} initialCode={join?.[1]} go={go} />;
}
