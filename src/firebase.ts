import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, onValue, ref } from 'firebase/database';

// Ces clés ne sont pas secrètes : la sécurité repose sur database.rules.json
const firebaseConfig = {
  apiKey: 'AIzaSyBEt3wbzx8Dy88rsY13MmZmPfHQA4vwXe4',
  authDomain: 'limit-wip-vleroy.firebaseapp.com',
  databaseURL: 'https://limit-wip-vleroy-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'limit-wip-vleroy',
  storageBucket: 'limit-wip-vleroy.firebasestorage.app',
  messagingSenderId: '413880351970',
  appId: '1:413880351970:web:c47cb90b74cee7fefd72bb',
};

const useEmulator = import.meta.env.VITE_EMULATOR === '1';

export const app = initializeApp(
  useEmulator ? { ...firebaseConfig, databaseURL: 'http://127.0.0.1:9000?ns=limit-wip-vleroy-default-rtdb' } : firebaseConfig,
);
export const auth = getAuth(app);
export const db = getDatabase(app);

if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
}

export function ensureSignedIn(): Promise<User> {
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, (user) => {
      if (user) {
        stop();
        resolve(user);
      }
    });
    signInAnonymously(auth).catch((e) => {
      stop();
      reject(e);
    });
  });
}

/** Décalage entre l'horloge locale et celle du serveur Firebase. */
let serverOffset = 0;
onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
  serverOffset = Number(snap.val()) || 0;
});
export function serverNow(): number {
  return Date.now() + serverOffset;
}
