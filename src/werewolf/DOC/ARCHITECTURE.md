# Architecture du Module Werewolf

## 📐 Vue d'Ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Vue.js + Three.js               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Lobby      │  │  GameBoard   │  │   Chat       │     │
│  │  Component   │  │  (3D Scene)  │  │  Component   │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                  │                  │             │
│         └──────────────────┴──────────────────┘             │
│                            │                                │
│                    Socket.IO Client                         │
└────────────────────────────┼───────────────────────────────┘
                             │
                    WebSocket Connection
                             │
┌────────────────────────────┼───────────────────────────────┐
│                    Backend (Node.js)                        │
│                            │                                │
│  ┌─────────────────────────▼─────────────────────────────┐ │
│  │         Socket.IO Server (/werewolf namespace)        │ │
│  │  ┌───────────────────────────────────────────────┐    │ │
│  │  │      werewolfSocket.js                        │    │ │
│  │  │  • connection/authentication                  │    │ │
│  │  │  • create-room / join-room / leave-room       │    │ │
│  │  │  • night-action / vote                        │    │ │
│  │  │  • chat-message                               │    │ │
│  │  │  • emit: room-state, phase-changed, deaths    │    │ │
│  │  └───────────────────┬───────────────────────────┘    │ │
│  └────────────────────────┼─────────────────────────────┘ │
│                           │                                │
│  ┌────────────────────────▼─────────────────────────────┐ │
│  │              RoomManager (Singleton)                 │ │
│  │  • rooms: Map<roomId, GameRoom>                     │ │
│  │  • userToRoom: Map<userId, roomId>                  │ │
│  │  • createRoom / joinRoom / leaveRoom                │ │
│  │  • cleanupFinishedGames (periodic)                  │ │
│  └───────────────────┬──────────────────────────────────┘ │
│                      │                                     │
│  ┌───────────────────▼──────────────────────────────────┐ │
│  │              GameRoom (Class Instance)              │ │
│  │  • players: Map<userId, Player>                     │ │
│  │  • phase: lobby/night/day/voting/ended              │ │
│  │  • turn: number                                     │ │
│  │  • nightActions: Map<playerId, action>              │ │
│  │  • dayVotes: Map<voterId, targetId>                 │ │
│  │  • Methods:                                         │ │
│  │    - startGame()                                    │ │
│  │    - transitionToPhase(phase)                       │ │
│  │    - registerNightAction()                          │ │
│  │    - registerVote()                                 │ │
│  │    - resolveNightActions()                          │ │
│  │    - resolveVoting()                                │ │
│  │    - checkWinCondition()                            │ │
│  └───────────────────┬──────────────────────────────────┘ │
│                      │                                     │
│  ┌───────────────────▼──────────────────────────────────┐ │
│  │                Player (Class Instance)              │ │
│  │  • userId, username, socketId                       │ │
│  │  • role: Role, team: string                         │ │
│  │  • isAlive, lives, armor                            │ │
│  │  • items: Array<Item>                               │ │
│  │  • statusEffects: Array<Effect>                     │ │
│  │  • Methods:                                         │ │
│  │    - takeDamage(amount)                             │ │
│  │    - heal(amount)                                   │ │
│  │    - addItem(item)                                  │ │
│  │    - useItem(itemId)                                │ │
│  │    - addStatusEffect(type, duration)                │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │          REST API Routes (Express Router)           │  │
│  │  GET  /api/werewolf/rooms                           │  │
│  │  GET  /api/werewolf/rooms/:id                       │  │
│  │  POST /api/werewolf/create                          │  │
│  │  POST /api/werewolf/join                            │  │
│  │  POST /api/werewolf/start                           │  │
│  │  POST /api/werewolf/night-action                    │  │
│  │  POST /api/werewolf/vote                            │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │       WerewolfPersistence (Class Instance)          │  │
│  │  • db: Database (shared with FlopoBot)              │  │
│  │  • statements: PreparedStatements                   │  │
│  │  • Methods:                                         │  │
│  │    - saveGameState(room)                            │  │
│  │    - saveRoomStateForRecovery(room)                 │  │
│  │    - loadRoomState(roomId)                          │  │
│  │    - updatePlayerStats(userId, result)              │  │
│  │    - getLeaderboard()                               │  │
│  └──────────────────┬──────────────────────────────────┘  │
│                     │                                      │
│  ┌──────────────────▼──────────────────────────────────┐  │
│  │    SQLite Database (flopobot.db - SHARED)           │  │
│  │  ┌────────────────────────────────────────────────┐ │  │
│  │  │ Werewolf Tables:                               │ │  │
│  │  │ • werewolf_games                               │ │  │
│  │  │ • werewolf_player_games                        │ │  │
│  │  │ • werewolf_player_stats                        │ │  │
│  │  │ • werewolf_saved_states                        │ │  │
│  │  │ • werewolf_achievements                        │ │  │
│  │  │ • werewolf_player_achievements                 │ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  │  ┌────────────────────────────────────────────────┐ │  │
│  │  │ FlopoBot Tables (existantes):                  │ │  │
│  │  │ • users, skins, elos, games, market_offers...  │ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  └─────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

## 🔄 Flux de Données

### 1. Création de Partie

```
Frontend                    Socket.IO                    Backend
   │                            │                            │
   │──── emit('create-room') ───▶                            │
   │                            │                            │
   │                            │──── RoomManager.createRoom()
   │                            │                            │
   │                            │◀──── new GameRoom() ───────│
   │                            │                            │
   │◀─── on('room-created') ────│                            │
   │                            │                            │
   │                            │──── emit('available-rooms')
   │◀─── on('available-rooms') ─│                            │
```

### 2. Déroulement d'une Nuit

```
GameRoom                    Timer                    Actions
   │                          │                         │
   │─ transitionToPhase('night')                        │
   │                          │                         │
   │─ phaseTimer = setTimeout(90s)                      │
   │                          │                         │
   │◀────────────────────────────── registerNightAction()
   │  nightActions.set(playerId, action)                │
   │                          │                         │
   │                     [Timer expire]                 │
   │◀─ handlePhaseEnd() ─────│                         │
   │                          │                         │
   │─ resolveNightActions()                             │
   │  │                                                  │
   │  ├─ Sort by role priority                          │
   │  ├─ Werewolves collective kill                     │
   │  ├─ Execute abilities (protect, vision, poison)    │
   │  ├─ Apply status effects                           │
   │  └─ Check deaths                                   │
   │                          │                         │
   │─ checkWinCondition()                               │
   │  │                                                  │
   │  └─ if no winner ────▶ transitionToPhase('day')    │
```

### 3. Vote de Jour

```
Players                     GameRoom                    Result
   │                          │                           │
   │─── registerVote(target) ─▶                           │
   │                          │                           │
   │  dayVotes.set(voterId, targetId)                    │
   │                          │                           │
   │             [Voting phase ends]                     │
   │                          │                           │
   │                    resolveVoting()                   │
   │                          │                           │
   │                    Count votes                       │
   │                          │                           │
   │                    Check majority                    │
   │                          │                           │
   │                    if majority ────▶ eliminate player
   │                          │                           │
   │                    checkWinCondition()               │
   │                          │                           │
   │◀─ emit('deaths-occurred')│                           │
   │◀─ emit('room-state') ────│                           │
```

## 🏗️ Patterns de Conception

### 1. Singleton Pattern
```javascript
// RoomManager est un singleton
export const roomManager = new RoomManager();
```

### 2. Factory Pattern
```javascript
// Routes utilise le factory pattern
export function werewolfRoutes() {
  const router = express.Router();
  // ...
  return router;
}
```

### 3. Observer Pattern
```javascript
// Socket.IO implémente l'observer pattern
socket.on('event', handler); // Subscribe
socket.emit('event', data);  // Publish
```

### 4. State Pattern
```javascript
// GameRoom gère les phases comme des états
class GameRoom {
  phase = 'lobby'; // lobby, night, day, voting, ended

  transitionToPhase(newPhase) {
    this.phase = newPhase;
    // Comportement spécifique selon la phase
  }
}
```

### 5. Strategy Pattern
```javascript
// Différentes stratégies de résolution d'actions
executeAbility(action) {
  switch (action.abilityId) {
    case 'seer_vision': return this.executeSeerVision(...);
    case 'guard_protect': return this.executeGuardProtect(...);
    case 'witch_heal': return this.executeWitchHeal(...);
    // ...
  }
}
```

## 🔐 Sécurité & Validation

### 1. Validation des Actions

```javascript
registerNightAction(playerId, abilityId, targets) {
  // 1. Vérifier que le joueur existe
  const player = this.getPlayer(playerId);
  if (!player) throw new Error('Player not found');

  // 2. Vérifier que le joueur peut agir
  if (!player.canAct()) throw new Error('Player cannot act');

  // 3. Vérifier la phase
  if (this.phase !== 'night') throw new Error('Not night phase');

  // 4. Valider l'ability
  const ability = player.role.abilities.find(a => a.id === abilityId);
  if (!ability) throw new Error('Invalid ability');

  // 5. Valider les cibles
  if (!this.validateTargets(player, ability, targets)) {
    throw new Error('Invalid targets');
  }

  // OK, enregistrer l'action
  this.nightActions.set(playerId, { ... });
}
```

### 2. Autorisation

```javascript
// Seul l'hôte peut démarrer
const player = room.getPlayer(userId);
if (!player?.isHost) {
  throw new Error('Only host can start game');
}
```

### 3. Sanitization des Données

```javascript
// Données publiques vs privées
getPublicData(includeRole = false) {
  return {
    userId: this.userId,
    username: this.username,
    isAlive: this.isAlive,
    // Rôle caché sauf si révélé
    role: (includeRole || this.isRevealed) ? this.role?.name : null
  };
}
```

## ⚡ Performance & Optimisation

### 1. Prepared Statements

```javascript
// Requêtes précompilées pour SQLite
this.statements = {
  saveGame: this.db.prepare(`INSERT OR REPLACE INTO ...`),
  getGame: this.db.prepare(`SELECT * FROM ...`),
  // ...
};
```

### 2. Indexation Base de Données

```javascript
// Index pour requêtes fréquentes
CREATE INDEX idx_werewolf_games_created_at ON werewolf_games(created_at DESC)
CREATE INDEX idx_werewolf_player_games_user_id ON werewolf_player_games(user_id)
```

### 3. Nettoyage Périodique

```javascript
// Éviter l'accumulation de données
setInterval(() => {
  roomManager.cleanupFinishedGames();
  persistence.cleanup(30); // 30 jours
}, 5 * 60 * 1000);
```

### 4. Émissions Ciblées

```javascript
// N'envoyer que les données nécessaires
room.players.forEach((player, userId) => {
  if (player.socketId) {
    // Chaque joueur reçoit SA vue personnalisée
    namespace.to(player.socketId).emit('room-state',
      room.getRoomStateForPlayer(userId)
    );
  }
});
```

## 🧩 Extensibilité

### Ajouter un Nouveau Rôle

```javascript
// Dans models/Role.js
export const ROLES = {
  // ...
  NEW_ROLE: new Role({
    id: 'new_role',
    name: 'Nouveau Rôle',
    team: 'villagers',
    description: '...',
    abilities: [
      new Ability({
        id: 'new_ability',
        name: 'Nouvelle Capacité',
        type: 'night',
        // ...
      })
    ]
  })
};

// Dans models/GameRoom.js
executeAbility(action) {
  // ...
  case 'new_ability':
    return this.executeNewAbility(player, action.targets);
}

executeNewAbility(player, targets) {
  // Logique de la nouvelle capacité
}
```

### Ajouter un Nouveau Type d'Item

```javascript
// Dans config/gameConfig.js
ITEMS: {
  NEW_ITEM: {
    id: 'new_item',
    name: 'Nouvel Item',
    description: '...',
    type: 'utility',
    uses: 1,
    rarity: 'rare'
  }
}
```

### Ajouter une Nouvelle Phase

```javascript
// Dans models/GameRoom.js
transitionToPhase(newPhase) {
  this.phase = newPhase;

  switch (newPhase) {
    case 'new_phase':
      this.handleNewPhase();
      break;
    // ...
  }
}

handleNewPhase() {
  // Logique de la nouvelle phase
}
```

## 📊 Monitoring & Métriques

### Logs Structurés

```javascript
console.log(`[Werewolf] ${timestamp} - ${level} - ${message}`, metadata);
```

### Métriques Disponibles

```javascript
GET /api/werewolf/stats

{
  "totalRooms": 150,
  "activeGames": 5,
  "lobbies": 3,
  "finishedGames": 142,
  "totalPlayers": 450
}
```

### Événements à Tracker

- Création de partie
- Début de partie
- Fin de partie (avec durée)
- Actions par phase
- Morts
- Victoires par équipe
- Utilisation d'items

## 🔄 Cycle de Vie d'une Partie

```
1. LOBBY
   ├─ Création de la room
   ├─ Joueurs rejoignent
   ├─ Joueurs se marquent "ready"
   └─ Hôte démarre ──▶ 2. ASSIGNMENT

2. ASSIGNMENT
   ├─ Distribution des rôles
   ├─ Initialisation des stats
   └─ Transition ──▶ 3. NIGHT (Tour 1)

3. NIGHT
   ├─ Loups votent pour tuer
   ├─ Rôles spéciaux agissent
   ├─ Résolution des actions
   ├─ Annonce des morts (cachée)
   └─ Transition ──▶ 4. DAY

4. DAY
   ├─ Révélation des morts de la nuit
   ├─ Discussion libre
   └─ Transition ──▶ 5. VOTING

5. VOTING
   ├─ Vote pour éliminer
   ├─ Comptage des votes
   ├─ Élimination si majorité
   └─ Check win condition ──▶ 6. NIGHT (Tour suivant) OU 7. END

6. NIGHT (Tour n)
   └─ Répète le cycle...

7. END
   ├─ Annonce du gagnant
   ├─ Révélation des rôles
   ├─ Sauvegarde des stats
   ├─ Attribution des achievements
   └─ Cleanup après 30 min
```

## 🎯 Décisions d'Architecture Clés

### Pourquoi des Classes au lieu d'Objets Simples?

- ✅ Encapsulation des données et logique
- ✅ Méthodes pour la manipulation d'état
- ✅ Plus facile à tester
- ✅ Meilleure maintenabilité

### Pourquoi Socket.IO ET REST?

- **Socket.IO**: Temps réel, bidirectionnel, parfait pour le jeu
- **REST**: Fallback, plus simple pour certains clients, facilite le debug

### Pourquoi SQLite Partagé?

- ✅ Simplicité (pas de config multi-DB)
- ✅ Transactions atomiques
- ✅ Peut lier les users Werewolf aux users FlopoBot
- ✅ Backup unique

### Pourquoi la Persistance des États?

- ✅ Récupération après crash
- ✅ Déploiement sans interruption
- ✅ Debug (rejouer une partie)

---

Cette architecture est conçue pour être **scalable**, **maintenable**, et **extensible** tout en restant simple et bien séparée du code existant.
