# Rush en cuisine · le jeu des limites de WIP

Un jeu en ligne, jouable à distance en 60 minutes, pour faire découvrir aux équipes les bénéfices des limites de travail en cours (WIP).

La brigade d'un restaurant (Préparation → Cuisson → Dressage) joue trois services de 15 tours :

| Service | Règle | Ce qu'on observe |
| --- | --- | --- |
| 1 · Sans limite | chacun tire autant de plats qu'il veut | les plats s'empilent, refroidissent, peu sortent |
| 2 · Limites de WIP | 2 plats maximum par station | le flux s'accélère, le goulot devient visible |
| 3 · Limites + entraide | un joueur peut aider les stations en aval | le goulot se résorbe |

Jouer : **https://agileroy.github.io/wip-limit-game/**

## Règles

- Chaque tour, chaque joueur lance un dé (1 à 6 points de travail) et place ses points sur des plats.
- **Changement de contexte** : chaque plat supplémentaire touché dans le tour coûte 1 point.
- **Un plat entamé refroidit** : 20 € s'il sort dans les 3 tours, puis −2 € par tour (un VIP vaut le double).
- Une commande jamais démarrée ne refroidit pas, mais le client part au bout de 6 tours.
- Les limites comptent les plats en cours **et** les plats prêts qui attendent la station suivante.
- Limite d'une station : 2 plats pour 1 cuisinier, +1 par cuisinier supplémentaire (réglable par l'animateur).
- Une partie 100 % robots avance toute seule (un tour toutes les 2,5 s) : pratique pour tester.

Tous les réglages sont dans `src/engine/types.ts` (`DEFAULT_CONFIG`) ; l'animateur peut changer la durée d'un tour, le nombre de tours et la limite depuis la salle d'attente.

## Animer une session

1. Ouvre le jeu, clique sur « Créer une salle » : tu arrives sur la table animateur.
2. Partage le lien ou le code. Chaque joueur choisit son prénom et sa station.
3. Complète au besoin avec des robots cuisiniers (pratique aussi pour tester seul).
4. Lance chaque service, puis anime le débrief à l'écran (questions proposées). Événements disponibles : table VIP, grande tablée (+3 commandes).

Le navigateur de l'animateur fait avancer les tours : il doit rester ouvert pendant la partie.

## Développement

```bash
npm install
npm test          # moteur du jeu (src/engine) + parties simulées avec des robots
npm run dev       # contre le vrai projet Firebase
npm run emulators # dans un autre terminal : émulateurs Auth + Realtime Database (Java requis)
npm run dev:emu   # front branché sur les émulateurs
```

## Architecture

- `src/engine/` : logique pure et testée (dés, changement de contexte, refroidissement, limites, entraide, métriques).
- `src/room.ts` : synchronisation Firebase Realtime Database (salles, joueurs, actions, tours).
- `src/ui/` : écrans joueur, table animateur, débrief.
- `database.rules.json` : règles de sécurité (seul l'animateur fait avancer la partie ; chaque joueur n'écrit que ses propres actions).
  La section `csRooms` sert au jeu [Une chose à la fois](https://github.com/agileroy/context-switching-game), qui partage ce projet Firebase : ne pas la supprimer.

## Déploiement

Chaque push sur `main` lance `.github/workflows/deploy.yml` :

- build + tests, puis publication sur GitHub Pages ;
- publication des règles de la base si le secret `FIREBASE_SERVICE_ACCOUNT` (clé JSON d'un compte de service du projet `limit-wip-vleroy`) est présent.
