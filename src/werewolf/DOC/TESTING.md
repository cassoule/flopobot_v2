# Guide de Test - Module Werewolf

Ce guide fournit des exemples de tests pour valider le module Werewolf.

## 🧪 Tests Manuels Rapides

### 1. Test de Création de Partie (REST)

```bash
# Créer une partie
curl -X POST http://localhost:25578/api/werewolf/create \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "player1",
    "username": "Alice",
    "config": {
      "maxPlayers": 10,
      "nightDuration": 60000
    }
  }'

# Réponse attendue:
# {
#   "success": true,
#   "roomId": "ABC123",
#   "room": { ... }
# }
```

### 2. Test de Jointure

```bash
# Rejoindre la partie
curl -X POST http://localhost:25578/api/werewolf/join \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "ABC123",
    "userId": "player2",
    "username": "Bob"
  }'
```

### 3. Test de Liste des Parties

```bash
# Lister les parties disponibles
curl http://localhost:25578/api/werewolf/rooms

# Réponse attendue:
# {
#   "success": true,
#   "rooms": [
#     {
#       "roomId": "ABC123",
#       "hostUsername": "Alice",
#       "playerCount": 2,
#       "maxPlayers": 10
#     }
#   ]
# }
```

### 4. Test WebSocket (Node.js)

```javascript
// test-socket.js
import { io } from 'socket.io-client';

const socket = io('http://localhost:25578/werewolf');

socket.on('connect', () => {
  console.log('✅ Connected');

  socket.emit('authenticate', {
    userId: 'test-user',
    username: 'TestPlayer'
  });
});

socket.on('available-rooms', (rooms) => {
  console.log('📋 Available rooms:', rooms.length);
  rooms.forEach(room => {
    console.log(`  - ${room.roomId}: ${room.playerCount}/${room.maxPlayers}`);
  });
});

socket.on('room-created', (data) => {
  console.log('✅ Room created:', data.roomId);
  console.log('Players:', data.state.players.length);
});

socket.on('error', (err) => {
  console.error('❌ Error:', err.message);
});

// Créer une partie après 1 seconde
setTimeout(() => {
  console.log('🎮 Creating room...');
  socket.emit('create-room', {
    userId: 'test-user',
    username: 'TestPlayer',
    config: { maxPlayers: 8 }
  });
}, 1000);
```

Exécuter :
```bash
node test-socket.js
```

## 🎯 Scénarios de Test Complets

### Scénario 1 : Partie Complète 4 Joueurs

```javascript
// test-full-game.js
import { io } from 'socket.io-client';

const players = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Charlie' },
  { id: 'p4', name: 'Diana' }
];

let roomId = null;
const sockets = [];

// Connexion de tous les joueurs
players.forEach((player, index) => {
  const socket = io('http://localhost:25578/werewolf');
  sockets.push(socket);

  socket.on('connect', () => {
    console.log(`✅ ${player.name} connected`);

    socket.emit('authenticate', {
      userId: player.id,
      username: player.name
    });

    if (index === 0) {
      // Premier joueur crée la partie
      setTimeout(() => {
        console.log('🎮 Creating room...');
        socket.emit('create-room', {
          userId: player.id,
          username: player.name,
          config: { minPlayers: 4, maxPlayers: 10 }
        });
      }, 1000);
    }
  });

  socket.on('room-created', (data) => {
    roomId = data.roomId;
    console.log(`✅ Room created: ${roomId}`);
  });

  socket.on('available-rooms', (rooms) => {
    if (index > 0 && roomId && !socket.joined) {
      // Autres joueurs rejoignent
      setTimeout(() => {
        console.log(`🚪 ${player.name} joining room ${roomId}...`);
        socket.emit('join-room', {
          roomId,
          userId: player.id,
          username: player.name
        });
        socket.joined = true;
      }, (index + 1) * 2000);
    }
  });

  socket.on('room-joined', (data) => {
    console.log(`✅ ${player.name} joined room`);

    // Marquer comme prêt
    setTimeout(() => {
      console.log(`✓ ${player.name} ready`);
      socket.emit('toggle-ready', {
        roomId: data.roomId,
        userId: player.id
      });
    }, 1000);
  });

  socket.on('room-state', (state) => {
    // Vérifier si tout le monde est prêt
    const allReady = state.players.every(p => p.isReady || p.isHost);

    if (index === 0 && allReady && !state.isStarted && !socket.started) {
      // L'hôte démarre la partie
      socket.started = true;
      setTimeout(() => {
        console.log('🎮 Starting game...');
        socket.emit('start-game', {
          roomId: state.roomId,
          userId: player.id
        });
      }, 2000);
    }
  });

  socket.on('game-started', (data) => {
    console.log(`🎮 Game started! Phase: ${data.phase}, Turn: ${data.turn}`);
  });

  socket.on('phase-changed', (data) => {
    console.log(`🌙 Phase changed: ${data.phase} (Turn ${data.turn})`);
  });

  socket.on('deaths-occurred', (data) => {
    console.log('💀 Deaths:', data.deaths.map(d => d.playerId).join(', '));
  });

  socket.on('error', (err) => {
    console.error(`❌ ${player.name} error:`, err.message);
  });
});

// Cleanup après 60 secondes
setTimeout(() => {
  console.log('🧹 Cleaning up...');
  sockets.forEach(s => s.disconnect());
  process.exit(0);
}, 60000);
```

### Scénario 2 : Test des Actions de Nuit

```javascript
// test-night-actions.js
import { io } from 'socket.io-client';

// Simuler un loup-garou qui vote
const werewolfSocket = io('http://localhost:25578/werewolf');

werewolfSocket.on('connect', () => {
  werewolfSocket.emit('authenticate', {
    userId: 'werewolf1',
    username: 'Wolf'
  });
});

werewolfSocket.on('room-state', (state) => {
  if (state.phase === 'night' && state.myPlayer?.team === 'werewolves') {
    // Trouver une cible
    const target = state.players.find(p =>
      p.isAlive && p.team !== 'werewolves'
    );

    if (target) {
      console.log(`🐺 Werewolf targeting ${target.username}`);

      werewolfSocket.emit('night-action', {
        roomId: state.roomId,
        userId: 'werewolf1',
        abilityId: 'werewolf_kill',
        targets: [target.userId]
      });
    }
  }
});

werewolfSocket.on('action-registered', (data) => {
  console.log('✅ Action registered:', data);
});

// Simuler une voyante
const seerSocket = io('http://localhost:25578/werewolf');

seerSocket.on('connect', () => {
  seerSocket.emit('authenticate', {
    userId: 'seer1',
    username: 'Seer'
  });
});

seerSocket.on('room-state', (state) => {
  if (state.phase === 'night' && state.myPlayer?.role === 'Voyante') {
    // Choisir quelqu'un à inspecter
    const target = state.players.find(p =>
      p.isAlive && p.userId !== 'seer1'
    );

    if (target) {
      console.log(`👁️ Seer inspecting ${target.username}`);

      seerSocket.emit('night-action', {
        roomId: state.roomId,
        userId: 'seer1',
        abilityId: 'seer_vision',
        targets: [target.userId]
      });
    }
  }
});

seerSocket.on('seer-vision', (data) => {
  console.log(`👁️ Vision result: ${data.target} is ${data.role} (${data.team})`);
});
```

### Scénario 3 : Test de Vote

```javascript
// test-voting.js
import { io } from 'socket.io-client';

const socket = io('http://localhost:25578/werewolf');

socket.on('connect', () => {
  socket.emit('authenticate', {
    userId: 'voter1',
    username: 'Voter'
  });
});

socket.on('room-state', (state) => {
  if (state.phase === 'voting' && state.myPlayer?.isAlive) {
    // Vote aléatoire
    const candidates = state.players.filter(p =>
      p.isAlive && p.userId !== 'voter1'
    );

    if (candidates.length > 0) {
      const target = candidates[Math.floor(Math.random() * candidates.length)];

      console.log(`🗳️ Voting for ${target.username}`);

      socket.emit('vote', {
        roomId: state.roomId,
        userId: 'voter1',
        targetId: target.userId
      });
    }
  }
});

socket.on('vote-registered', (data) => {
  console.log('✅ Vote registered for:', data.targetId);
});

socket.on('vote-update', (data) => {
  console.log('📊 Vote counts:', data.voteCounts);
  console.log(`Progress: ${data.totalVotes}/${data.requiredVotes}`);
});
```

## 🔍 Tests de Base de Données

### Vérifier les Tables Créées

```sql
-- Ouvrir la DB
sqlite3 flopobot.db

-- Lister toutes les tables Werewolf
.tables werewolf%

-- Vérifier le schéma
.schema werewolf_games
.schema werewolf_player_stats

-- Compter les parties
SELECT COUNT(*) FROM werewolf_games;

-- Voir les achievements
SELECT * FROM werewolf_achievements;

-- Top 10 joueurs
SELECT username, total_wins, total_games
FROM werewolf_player_stats
ORDER BY total_wins DESC
LIMIT 10;
```

### Nettoyer les Données de Test

```sql
-- Supprimer toutes les parties de test
DELETE FROM werewolf_games WHERE room_id LIKE 'TEST%';

-- Réinitialiser les stats d'un joueur
DELETE FROM werewolf_player_stats WHERE user_id = 'test-user';

-- Supprimer tous les états sauvegardés
DELETE FROM werewolf_saved_states WHERE is_active = 0;
```

## 📊 Tests de Performance

### Test de Charge (Créer 100 Parties)

```javascript
// test-load.js
import axios from 'axios';

const API_URL = 'http://localhost:25578/api/werewolf';

async function createManyRooms(count) {
  const promises = [];

  for (let i = 0; i < count; i++) {
    promises.push(
      axios.post(`${API_URL}/create`, {
        userId: `loadtest-${i}`,
        username: `LoadTest${i}`
      }).catch(err => console.error(`Room ${i} failed:`, err.message))
    );
  }

  const start = Date.now();
  const results = await Promise.all(promises);
  const duration = Date.now() - start;

  const successful = results.filter(r => r?.data?.success).length;

  console.log(`Created ${successful}/${count} rooms in ${duration}ms`);
  console.log(`Average: ${(duration / count).toFixed(2)}ms per room`);

  return results.map(r => r?.data?.roomId).filter(Boolean);
}

createManyRooms(100).then(() => {
  console.log('✅ Load test complete');
  process.exit(0);
});
```

### Test de Connexions Simultanées

```javascript
// test-concurrent.js
import { io } from 'socket.io-client';

const CONCURRENT_USERS = 50;

async function testConcurrentConnections() {
  const sockets = [];

  console.log(`Creating ${CONCURRENT_USERS} concurrent connections...`);
  const start = Date.now();

  for (let i = 0; i < CONCURRENT_USERS; i++) {
    const socket = io('http://localhost:25578/werewolf');

    socket.on('connect', () => {
      socket.emit('authenticate', {
        userId: `concurrent-${i}`,
        username: `User${i}`
      });
    });

    sockets.push(socket);
  }

  // Attendre que tous soient connectés
  await new Promise(resolve => {
    let connected = 0;
    sockets.forEach(socket => {
      socket.on('available-rooms', () => {
        connected++;
        if (connected === CONCURRENT_USERS) {
          resolve();
        }
      });
    });
  });

  const duration = Date.now() - start;
  console.log(`✅ All ${CONCURRENT_USERS} users connected in ${duration}ms`);

  // Cleanup
  sockets.forEach(s => s.disconnect());
}

testConcurrentConnections();
```

## ✅ Checklist de Validation

### API REST

- [ ] Créer une partie
- [ ] Lister les parties
- [ ] Obtenir une partie spécifique
- [ ] Rejoindre une partie
- [ ] Quitter une partie
- [ ] Marquer comme prêt
- [ ] Démarrer une partie
- [ ] Enregistrer une action de nuit
- [ ] Enregistrer un vote
- [ ] Utiliser un item

### WebSocket

- [ ] Connexion au namespace `/werewolf`
- [ ] Authentification
- [ ] Création de salle
- [ ] Jointure de salle
- [ ] Réception de `room-state`
- [ ] Réception de `available-rooms`
- [ ] Réception de `game-started`
- [ ] Réception de `phase-changed`
- [ ] Réception de `deaths-occurred`
- [ ] Chat fonctionnel

### Game Logic

- [ ] Attribution des rôles (distribution équilibrée)
- [ ] Transition de phases (timers corrects)
- [ ] Actions de nuit (werewolf, seer, guardian)
- [ ] Résolution des actions (ordre de priorité)
- [ ] Vote de jour (majorité requise)
- [ ] Condition de victoire (werewolves)
- [ ] Condition de victoire (villagers)
- [ ] Système de vies multiples
- [ ] Système d'armure
- [ ] Utilisation d'items

### Persistance

- [ ] Tables créées correctement
- [ ] Achievements seedés
- [ ] Sauvegarde de l'état de jeu
- [ ] Récupération après redémarrage
- [ ] Mise à jour des statistiques
- [ ] Leaderboard fonctionnel
- [ ] Nettoyage des anciennes données

### Edge Cases

- [ ] Déconnexion pendant la partie
- [ ] Reconnexion
- [ ] Hôte quitte (transfert d'hôte)
- [ ] Tous les joueurs quittent
- [ ] Action invalide (mauvaise cible)
- [ ] Vote sans majorité
- [ ] Partie avec nombre minimum de joueurs
- [ ] Partie avec nombre maximum de joueurs

## 🐛 Debug

### Activer les Logs Détaillés

```javascript
// Dans index.js
const DEBUG = process.env.DEBUG === 'true';

if (DEBUG) {
  console.log('[DEBUG] Room state:', JSON.stringify(room, null, 2));
}
```

### Inspecter l'État d'une Partie

```javascript
// Ajouter un endpoint de debug
app.get('/api/werewolf/debug/:roomId', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  res.json({
    roomId: room.roomId,
    phase: room.phase,
    turn: room.turn,
    players: Array.from(room.players.values()).map(p => ({
      userId: p.userId,
      username: p.username,
      role: p.role?.name,
      team: p.team,
      isAlive: p.isAlive,
      lives: p.lives
    })),
    nightActions: Array.from(room.nightActions.values()),
    dayVotes: Array.from(room.dayVotes.entries())
  });
});
```

### Forcer une Phase

```javascript
// Endpoint de debug pour changer de phase
app.post('/api/werewolf/debug/:roomId/phase', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  room.handlePhaseEnd(); // Force la fin de phase
  res.json({ success: true, newPhase: room.phase });
});
```

---

Ces tests vous permettront de valider complètement le module Werewolf avant de le déployer en production!
