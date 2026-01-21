# Werewolf Game Module

Module de jeu Loup-Garou multijoueur en temps réel pour FlopoBot v2. Inspiré des Loups-Garous de Thiercelieux avec des mécaniques avancées.

## 🎮 Caractéristiques

- **Système de rôles avancé** : Villageois, Loups-Garous, Voyante, Gardien, Sorcière, Chasseur, etc.
- **Vies multiples** : Les joueurs peuvent avoir plusieurs vies et de l'armure
- **Système d'items** : Boucliers, potions, bonus temporaires
- **Chat par équipe** : Communication séparée pour les loups et les morts
- **Persistance complète** : Récupération des parties après redémarrage
- **Statistiques & Achievements** : Suivi des performances et déblocage de succès
- **WebSocket temps réel** : Synchronisation instantanée de tous les joueurs

## 📁 Structure du Module

```
src/werewolf/
├── models/              # Modèles de données
│   ├── Player.js        # Joueur (vies, items, statuts)
│   ├── Role.js          # Définitions des rôles et capacités
│   └── GameRoom.js      # Salle de jeu (état, phases, logique)
├── managers/            # Gestionnaires
│   └── RoomManager.js   # Gestion des salles (création, join, matchmaking)
├── routes/              # API REST
│   └── werewolfRoutes.js # Endpoints HTTP
├── socket/              # WebSocket
│   └── werewolfSocket.js # Événements temps réel
├── database/            # Persistance
│   ├── schema.js        # Schéma de base de données
│   └── persistence.js   # Opérations DB
├── config/              # Configuration
│   └── gameConfig.js    # Paramètres du jeu
└── index.js             # Point d'entrée principal
```

## 🚀 Intégration

### 1. Dans `index.js` (serveur principal)

```javascript
import { flopoDB } from './src/database/index.js';
import { initializeWerewolf, werewolfRoutes } from './src/werewolf/index.js';

// Après l'initialisation de Socket.IO
initializeWerewolf(io, flopoDB);

// Enregistrer les routes
app.use('/api/werewolf', werewolfRoutes());
```

### 2. Configuration (optionnelle)

```javascript
initializeWerewolf(io, flopoDB, {
  minPlayers: 4,
  maxPlayers: 20,
  nightDuration: 90000,
  dayDuration: 180000,
  enableItems: true
});
```

## 🎯 Utilisation

### Créer une Partie (WebSocket)

```javascript
// Client-side
const socket = io('/werewolf');

socket.emit('authenticate', {
  userId: 'user123',
  username: 'Player1'
});

socket.emit('create-room', {
  userId: 'user123',
  username: 'Player1',
  config: {
    maxPlayers: 10,
    nightDuration: 60000
  }
});

socket.on('room-created', (data) => {
  console.log('Room ID:', data.roomId);
  console.log('State:', data.state);
});
```

### Rejoindre une Partie

```javascript
socket.emit('join-room', {
  roomId: 'ABC123',
  userId: 'user456',
  username: 'Player2'
});

socket.on('room-joined', (data) => {
  console.log('Joined room:', data.roomId);
});

socket.on('player-joined', (data) => {
  console.log(`${data.username} joined (${data.playerCount} players)`);
});
```

### Actions de Nuit

```javascript
// Loup-Garou vote pour tuer
socket.emit('night-action', {
  roomId: 'ABC123',
  userId: 'user123',
  abilityId: 'werewolf_kill',
  targets: ['targetUserId']
});

// Voyante révèle un rôle
socket.emit('night-action', {
  roomId: 'ABC123',
  userId: 'user456',
  abilityId: 'seer_vision',
  targets: ['targetUserId']
});

socket.on('seer-vision', (data) => {
  console.log(`${data.target} is ${data.role} (${data.team})`);
});
```

### Vote de Jour

```javascript
socket.emit('vote', {
  roomId: 'ABC123',
  userId: 'user123',
  targetId: 'suspectUserId'
});

socket.on('vote-update', (data) => {
  console.log('Vote counts:', data.voteCounts);
  console.log('Votes needed:', data.requiredVotes);
});
```

### Chat

```javascript
socket.emit('chat-message', {
  roomId: 'ABC123',
  userId: 'user123',
  channel: 'all', // 'all', 'werewolves', 'dead'
  message: 'Je pense que c\'est lui le loup!'
});

socket.on('chat-message', (data) => {
  console.log(`[${data.channel}] ${data.username}: ${data.message}`);
});
```

## 📡 API REST (Alternative au WebSocket)

### Créer une Partie

```http
POST /api/werewolf/create
Content-Type: application/json

{
  "userId": "user123",
  "username": "Player1",
  "config": {
    "maxPlayers": 10
  }
}
```

### Lister les Parties Disponibles

```http
GET /api/werewolf/rooms
```

### Rejoindre une Partie

```http
POST /api/werewolf/join
Content-Type: application/json

{
  "roomId": "ABC123",
  "userId": "user456",
  "username": "Player2"
}
```

### Obtenir l'État de la Partie

```http
GET /api/werewolf/rooms/ABC123?userId=user123
```

### Action de Nuit

```http
POST /api/werewolf/night-action
Content-Type: application/json

{
  "roomId": "ABC123",
  "userId": "user123",
  "abilityId": "werewolf_kill",
  "targets": ["targetUserId"]
}
```

### Voter

```http
POST /api/werewolf/vote
Content-Type: application/json

{
  "roomId": "ABC123",
  "userId": "user123",
  "targetId": "suspectUserId"
}
```

## 🎭 Rôles Disponibles

### Équipe Villageois

- **Villageois** : Aucun pouvoir, participe aux votes
- **Voyante** : Révèle un rôle chaque nuit
- **Gardien** : Protège un joueur chaque nuit
- **Sorcière** : 1 potion de vie et 1 potion de mort
- **Chasseur** : Tue un joueur en mourant
- **Maudit** : Devient loup s'il est attaqué

### Équipe Loups-Garous

- **Loup-Garou** : Vote pour tuer chaque nuit
- **Loup Alpha** : Loup avec 2 vies et 1 armure (10+ joueurs)

### Neutre

- **Farceur** : Gagne s'il survit ou se fait éliminer par vote

## 📊 Base de Données

Le module ajoute les tables suivantes à la DB existante :

- `werewolf_games` : Historique des parties
- `werewolf_player_games` : Performances individuelles par partie
- `werewolf_player_stats` : Statistiques cumulées des joueurs
- `werewolf_saved_states` : États sauvegardés pour récupération
- `werewolf_achievements` : Définitions des succès
- `werewolf_player_achievements` : Succès débloqués

## 🔧 Configuration

Voir [gameConfig.js](config/gameConfig.js) pour tous les paramètres :

```javascript
GAME_CONFIG = {
  MIN_PLAYERS: 4,
  MAX_PLAYERS: 20,
  NIGHT_DURATION: 90000,    // 1.5 min
  DAY_DURATION: 180000,     // 3 min
  VOTING_DURATION: 60000,   // 1 min
  WEREWOLF_RATIO: 0.33,     // 33% de loups
  // ...
}
```

## 🎨 Frontend Vue.js + Three.js

Le module fournit le backend complet. Pour le frontend :

1. **Connexion WebSocket** à `/werewolf`
2. **Authentification** avec userId/username
3. **Écoute des événements** :
   - `room-state` : État complet de la partie
   - `phase-changed` : Changement de phase (nuit/jour/vote)
   - `deaths-occurred` : Annonce des morts
   - `chat-message` : Messages du chat
   - `player-joined/left` : Joueurs qui rejoignent/quittent

4. **Rendu 3D avec Three.js** :
   - Représentation visuelle des joueurs en cercle
   - Animations lors des phases
   - Effets visuels pour les morts, protections, etc.

## 📈 Statistiques & Leaderboards

```javascript
// API pour obtenir le classement
GET /api/werewolf/stats

// Réponse
{
  "totalRooms": 150,
  "activeGames": 5,
  "lobbies": 3,
  "totalPlayers": 89
}
```

## 🔐 Persistance & Récupération

- **Auto-save** : Toutes les 30 secondes pour les parties actives
- **Récupération** : Au redémarrage du serveur, restaure les parties en cours
- **Nettoyage** : Parties finies supprimées après 30 jours

## 🎯 Achievements

Exemples :
- **Premier Sang** : Première victoire
- **Alpha Suprême** : 10 victoires en Loup-Garou
- **Héros du Village** : 10 victoires en Villageois
- **Tueur en Série** : 50 kills totaux
- **Perfection** : Victoire villageois sans aucune mort

## 🐛 Debug & Logs

Tous les logs sont préfixés par `[Werewolf]` :

```
[Werewolf] Client connected: socket-id
[Werewolf] Room created: ABC123 by Player1
[Werewolf] Game started in room ABC123
[Werewolf] Night action: werewolf_kill by user123
[Werewolf] Auto-saved 3 active games
```

## 🚧 À Développer (Frontend)

1. Interface de lobby avec liste des salles
2. Écran de jeu avec cercle de joueurs en 3D
3. Interface pour les actions de nuit (sélection de cible)
4. Système de vote avec timer
5. Chat avec channels séparés
6. Historique des morts et actions
7. Écran de fin avec statistiques

## 📝 License

Partie du projet FlopoBot v2
