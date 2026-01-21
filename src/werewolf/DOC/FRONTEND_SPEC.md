# Spécification Frontend - Jeu Werewolf

Ce document décrit l'API backend et les événements WebSocket pour intégrer le jeu Werewolf dans le frontend Vue.js + Three.js.

---

## 🔐 Authentification

Le système utilise l'authentification Discord. L'ID Discord et le username sont stockés en localStorage après le login OAuth.

**Prérequis** : L'utilisateur doit être authentifié via Discord avant de pouvoir jouer.

---

## 🔌 Connexion WebSocket

### Configuration

```javascript
import { io } from 'socket.io-client';

// Connexion au namespace dédié Werewolf
const socket = io('http://localhost:25578/werewolf', {
  transports: ['websocket']
});
```

### Authentification (OBLIGATOIRE)

**Dès la connexion**, envoyer l'événement `authenticate` avec les infos Discord :

```javascript
socket.on('connect', () => {
  const discordId = localStorage.getItem('userId');      // ID Discord
  const username = localStorage.getItem('globalName');   // Nom d'affichage Discord

  socket.emit('authenticate', {
    userId: discordId,
    username: username
  });
});

// Confirmation d'authentification
socket.on('authenticated', ({ userId, username }) => {
  console.log(`Authentifié: ${username} (${userId})`);
  // L'utilisateur peut maintenant créer/rejoindre des parties
});

// Erreur d'authentification
socket.on('error', ({ message }) => {
  console.error('Erreur:', message);
});
```

> **Important** : Une fois authentifié, le backend stocke les infos. Tu n'as plus besoin de passer `userId` et `username` dans les événements suivants (le backend utilise les valeurs stockées comme fallback).

---

## 📡 Événements WebSocket

### Événements à ENVOYER (emit)

| Événement | Payload | Description |
|-----------|---------|-------------|
| `authenticate` | `{ userId, username }` | **Obligatoire** - Authentifie l'utilisateur |
| `create-room` | `{ config? }` | Crée une nouvelle salle |
| `join-room` | `{ roomId }` | Rejoindre une salle existante |
| `leave-room` | `{}` | Quitter la salle actuelle |
| `toggle-ready` | `{}` | Basculer l'état "prêt" |
| `start-game` | `{}` | Démarrer la partie (hôte uniquement) |
| `night-action` | `{ abilityId, targets }` | Action de nuit (ex: vote loup, vision voyante) |
| `vote` | `{ targetId }` | Voter pour éliminer un joueur (phase voting) |
| `use-item` | `{ itemId, targets? }` | Utiliser un item |
| `chat-message` | `{ channel, message }` | Envoyer un message chat |

### Événements à ÉCOUTER (on)

| Événement | Payload | Description |
|-----------|---------|-------------|
| `authenticated` | `{ userId, username }` | Confirmation d'authentification |
| `available-rooms` | `Room[]` | Liste des salles disponibles (lobby) |
| `room-created` | `{ roomId, state }` | Salle créée avec succès |
| `room-joined` | `{ roomId, state }` | Salle rejointe avec succès |
| `room-left` | `{}` | Confirmation de départ |
| `room-state` | `RoomState` | État complet de la salle (envoyé régulièrement) |
| `player-joined` | `{ userId, username, playerCount }` | Un joueur a rejoint |
| `player-left` | `{ userId, username, playerCount }` | Un joueur a quitté |
| `player-disconnected` | `{ userId, username }` | Un joueur s'est déconnecté (en jeu) |
| `game-started` | `{ turn, phase }` | La partie a commencé |
| `phase-changed` | `{ phase, turn, phaseEndTime }` | Changement de phase |
| `action-registered` | `{ abilityId, targets }` | Action enregistrée |
| `werewolves-voted` | `{}` | Tous les loups ont voté |
| `vote-registered` | `{ targetId }` | Vote enregistré |
| `vote-update` | `{ voteCounts, totalVotes, requiredVotes }` | Mise à jour des votes |
| `deaths-occurred` | `{ deaths }` | Annonce des morts |
| `seer-vision` | `{ target, role, team }` | Résultat de la vision (voyante uniquement) |
| `item-used` | `{ item, targets }` | Item utilisé |
| `chat-message` | `ChatMessage` | Nouveau message chat |
| `error` | `{ message }` | Erreur |

---

## 📊 Structures de Données

### RoomState (état de la salle)

```typescript
interface RoomState {
  roomId: string;
  phase: 'lobby' | 'night' | 'day' | 'voting' | 'ended';
  turn: number;
  isStarted: boolean;
  phaseEndTime: number | null;  // Timestamp de fin de phase (pour le timer)
  config: GameConfig;
  players: Player[];
  myPlayer: Player | null;      // Ton joueur avec infos privées (rôle, items)
  chatChannels: string[];       // Canaux accessibles ['all', 'werewolves'?, 'dead'?]
  recentDeaths: Death[];
  winnersTeam: 'villagers' | 'werewolves' | 'neutral' | null;
}
```

### Player

```typescript
interface Player {
  userId: string;
  username: string;
  isAlive: boolean;
  isReady: boolean;      // En lobby uniquement
  isHost: boolean;

  // Infos privées (uniquement pour myPlayer ou si mort/fin de partie)
  role?: Role;
  team?: 'villagers' | 'werewolves' | 'neutral';
  lives?: number;
  armor?: number;
  items?: Item[];
  statusEffects?: StatusEffect[];
}
```

### Role

```typescript
interface Role {
  id: string;
  name: string;           // Ex: "Loup-Garou", "Voyante", "Villageois"
  team: 'villagers' | 'werewolves' | 'neutral';
  description: string;
  abilities: Ability[];
}
```

### Ability (capacité de rôle)

```typescript
interface Ability {
  id: string;
  name: string;
  description: string;
  type: 'night' | 'day' | 'passive' | 'triggered';
  usesPerGame: number;    // Infinity si illimité
  usesPerNight: number;
  targetType: 'single' | 'multiple' | 'self' | 'none';
}
```

### Item

```typescript
interface Item {
  id: string;
  name: string;
  description: string;
  uses: number;
  maxUses: number;
}
```

### GameConfig

```typescript
interface GameConfig {
  minPlayers: number;       // Default: 4
  maxPlayers: number;       // Default: 20
  dayDuration: number;      // ms, default: 180000 (3 min)
  nightDuration: number;    // ms, default: 90000 (1.5 min)
  voteDuration: number;     // ms, default: 60000 (1 min)
  enableItems: boolean;
  enableChat: boolean;
}
```

### ChatMessage

```typescript
interface ChatMessage {
  userId: string;
  username: string;
  message: string;
  channel: 'all' | 'werewolves' | 'dead';
  timestamp: number;
}
```

### Death

```typescript
interface Death {
  playerId: string;
  turn: number;
  phase: string;
  cause: 'werewolf_attack' | 'voted_out' | 'witch_poison' | 'hunter_revenge';
}
```

### AvailableRoom (pour la liste des salles)

```typescript
interface AvailableRoom {
  roomId: string;
  hostUsername: string;
  playerCount: number;
  maxPlayers: number;
  isStarted: boolean;
}
```

---

## 🎮 Phases de Jeu

### 1. `lobby` - Salle d'attente
- Les joueurs rejoignent
- Chacun peut toggle "ready"
- L'hôte peut démarrer quand tous sont ready et min players atteint

### 2. `night` - Phase de nuit
- **Loups-Garous** : votent ensemble pour tuer (ability: `werewolf_kill`)
- **Voyante** : choisit un joueur à inspecter (ability: `seer_vision`)
- **Gardien** : protège un joueur (ability: `guard_protect`)
- **Sorcière** : peut utiliser ses potions (abilities: `witch_heal`, `witch_kill`)
- Timer automatique, fin de phase quand timer expire

### 3. `day` - Phase de discussion
- Chat ouvert à tous les vivants
- Pas d'action, juste discussion
- Timer puis passage au vote

### 4. `voting` - Phase de vote
- Chaque joueur vivant vote pour éliminer quelqu'un
- Majorité absolue requise pour éliminer
- `vote-update` envoyé à chaque vote

### 5. `ended` - Fin de partie
- `winnersTeam` indique l'équipe gagnante
- Tous les rôles sont révélés

---

## 🐺 Rôles Disponibles

| ID | Nom | Équipe | Capacité |
|----|-----|--------|----------|
| `villager` | Villageois | Villageois | Aucune |
| `werewolf` | Loup-Garou | Loups | Vote collectif pour tuer |
| `alpha_werewolf` | Loup Alpha | Loups | 2 vies, 1 armure |
| `seer` | Voyante | Villageois | Révèle un rôle par nuit |
| `guardian` | Gardien | Villageois | Protège un joueur par nuit |
| `witch` | Sorcière | Villageois | 1 potion vie, 1 potion mort |
| `hunter` | Chasseur | Villageois | Tue quelqu'un en mourant |
| `trickster` | Farceur | Neutre | Gagne s'il survit ou se fait voter |
| `cursed` | Maudit | Villageois→Loups | Devient loup si attaqué |

---

## 💬 Système de Chat

### Canaux

| Canal | Qui peut voir | Quand |
|-------|--------------|-------|
| `all` | Tous les joueurs | Toujours (sauf nuit en option) |
| `werewolves` | Loups-Garous vivants | Phase nuit uniquement |
| `dead` | Joueurs morts | Après leur mort |

### Envoyer un message

```javascript
socket.emit('chat-message', {
  channel: 'all',  // ou 'werewolves' si loup, ou 'dead' si mort
  message: 'Je pense que c\'est Bob le loup!'
});
```

### Recevoir un message

```javascript
socket.on('chat-message', (msg) => {
  // msg = { userId, username, message, channel, timestamp }
  addMessageToChat(msg);
});
```

---

## ⏱️ Gestion des Timers

Le backend envoie `phaseEndTime` (timestamp en ms) pour savoir quand la phase se termine.

```javascript
// Calculer le temps restant
const timeRemaining = Math.max(0, Math.floor((phaseEndTime - Date.now()) / 1000));

// Mettre à jour chaque seconde
setInterval(() => {
  const remaining = Math.max(0, Math.floor((phaseEndTime - Date.now()) / 1000));
  displayTimer(remaining);
}, 1000);
```

---

## 🎯 Exemple de Flow Complet

```javascript
// 1. Connexion et authentification
const socket = io('http://localhost:25578/werewolf');

socket.on('connect', () => {
  socket.emit('authenticate', {
    userId: localStorage.getItem('userId'),
    username: localStorage.getItem('globalName')
  });
});

socket.on('authenticated', () => {
  console.log('Prêt à jouer!');
});

// 2. Recevoir la liste des salles
socket.on('available-rooms', (rooms) => {
  displayRoomList(rooms);
});

// 3. Créer ou rejoindre une salle
function createRoom() {
  socket.emit('create-room', {
    config: { maxPlayers: 10 }
  });
}

function joinRoom(roomId) {
  socket.emit('join-room', { roomId });
}

// 4. Gérer l'état de la salle
socket.on('room-state', (state) => {
  updateGameUI(state);

  // Mettre à jour le timer
  if (state.phaseEndTime) {
    startTimer(state.phaseEndTime);
  }
});

// 5. Toggle ready (en lobby)
function toggleReady() {
  socket.emit('toggle-ready', {});
}

// 6. Démarrer la partie (hôte)
function startGame() {
  socket.emit('start-game', {});
}

// 7. Action de nuit
function performNightAction(abilityId, targetUserId) {
  socket.emit('night-action', {
    abilityId: abilityId,        // ex: 'werewolf_kill', 'seer_vision'
    targets: [targetUserId]
  });
}

// 8. Voter (phase voting)
function vote(targetUserId) {
  socket.emit('vote', {
    targetId: targetUserId
  });
}

// 9. Écouter les résultats
socket.on('seer-vision', ({ target, role, team }) => {
  showVisionResult(`${target} est ${role} (${team})`);
});

socket.on('deaths-occurred', ({ deaths }) => {
  deaths.forEach(d => {
    showDeathAnimation(d.playerId, d.cause);
  });
});

socket.on('phase-changed', ({ phase, turn, phaseEndTime }) => {
  updatePhaseUI(phase, turn);
  startTimer(phaseEndTime);
});
```

---

## 🎨 UI Recommandée

### Écrans à créer

1. **Lobby** - Liste des salles, bouton créer
2. **Waiting Room** - Liste joueurs, boutons ready/start
3. **Game Board** - Vue 3D des joueurs en cercle
4. **Night Panel** - Sélection de cible pour actions nocturnes
5. **Vote Panel** - Sélection pour voter
6. **Chat Panel** - Multi-canal
7. **End Screen** - Résultats, rôles révélés

### Informations à afficher

- Phase actuelle + timer
- Tour actuel
- Liste des joueurs (vivants/morts)
- Mon rôle + mes capacités
- Mes items
- Historique des morts récentes

### Actions Three.js suggérées

- Cercle de joueurs (position en fonction du nombre)
- Animation de mort (tombe/fade out)
- Effet de protection (bouclier lumineux)
- Indicateur de vote (flèches vers la cible)
- Transition jour/nuit (changement de lumière)

---

## ⚠️ Points Importants

1. **Toujours `authenticate` en premier** après connexion
2. **`room-state`** est la source de vérité - met à jour ton UI à chaque réception
3. **Le rôle est privé** - seul `myPlayer` contient le rôle, sauf après la mort ou fin de partie
4. **Les loups voient les autres loups** - dans `room-state`, les autres loups sont identifiés si tu es loup
5. **Timer côté client** - utilise `phaseEndTime` pour afficher le countdown
6. **Gère les déconnexions** - écoute `player-disconnected` et `error`

---

## 🔗 API REST (Alternative/Fallback)

En plus du WebSocket, une API REST est disponible :

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/werewolf/rooms` | Liste des salles |
| GET | `/api/werewolf/rooms/:id?userId=xxx` | État d'une salle |
| POST | `/api/werewolf/create` | Créer une salle |
| POST | `/api/werewolf/join` | Rejoindre |
| POST | `/api/werewolf/leave` | Quitter |
| POST | `/api/werewolf/ready` | Toggle ready |
| POST | `/api/werewolf/start` | Démarrer |
| POST | `/api/werewolf/night-action` | Action de nuit |
| POST | `/api/werewolf/vote` | Voter |
| GET | `/api/werewolf/stats` | Statistiques serveur |

---

## 📝 Notes pour l'Intégration

- Le backend tourne sur le même serveur que FlopoBot (port 25578)
- Utilise le même système d'authentification Discord
- Les données utilisateur (coins, etc.) ne sont PAS liées au jeu Werewolf pour l'instant
- Le jeu est indépendant mais partage l'infrastructure

---

Bonne chance pour le frontend! 🎮🐺
