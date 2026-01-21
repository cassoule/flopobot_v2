# Guide d'Intégration - Module Werewolf

Ce guide montre comment intégrer le module Werewolf dans le serveur FlopoBot v2 existant.

## 📋 Prérequis

Le module Werewolf réutilise l'infrastructure existante :
- ✅ Base de données SQLite (via `better-sqlite3`)
- ✅ Serveur Socket.IO
- ✅ Serveur Express
- ✅ Aucune dépendance supplémentaire nécessaire

## 🔧 Étape 1 : Modifier `index.js`

Ajoutez l'import et l'initialisation du module Werewolf :

```javascript
// Dans index.js (à la racine)
import { flopoDB } from './src/database/index.js';
import { initializeWerewolf, werewolfRoutes } from './src/werewolf/index.js';

// ... autres imports ...

// APRÈS la création de l'instance Socket.IO
const io = new Server(server, {
  cors: {
    origin: FLAPI_URL,
    methods: ["GET", "POST", "PUT", "OPTIONS"],
  }
});

// ===== INITIALISATION WEREWOLF =====
console.log('[Server] Initializing Werewolf module...');
const { persistence: werewolfPersistence } = initializeWerewolf(io, flopoDB);
console.log('[Server] Werewolf module initialized');

// ... suite du code ...
```

## 🔧 Étape 2 : Modifier `src/server/app.js`

Ajoutez les routes API Werewolf :

```javascript
// Dans src/server/app.js
import { werewolfRoutes } from '../werewolf/index.js';

// ... autres imports et configuration ...

// ENREGISTRER LES ROUTES WEREWOLF
app.use("/api/werewolf", werewolfRoutes());

// ... autres routes existantes ...
```

## 📊 Étape 3 : Vérification de la Base de Données

Le module créera automatiquement ses tables au premier lancement. Vous pouvez vérifier :

```javascript
// Les tables suivantes seront ajoutées à flopobot.db :
// - werewolf_games
// - werewolf_player_games
// - werewolf_player_stats
// - werewolf_saved_states
// - werewolf_achievements
// - werewolf_player_achievements
// - werewolf_leaderboard_snapshots
```

Pour inspecter :

```bash
sqlite3 flopobot.db
sqlite> .tables
sqlite> SELECT * FROM werewolf_achievements;
```

## 🧪 Étape 4 : Test de l'Installation

### Test 1 : API REST

```bash
# Créer une partie
curl -X POST http://localhost:25578/api/werewolf/create \
  -H "Content-Type: application/json" \
  -d '{"userId":"test1","username":"TestPlayer1"}'

# Lister les parties
curl http://localhost:25578/api/werewolf/rooms

# Obtenir les statistiques
curl http://localhost:25578/api/werewolf/stats
```

### Test 2 : WebSocket

```javascript
// test-werewolf.js
import io from 'socket.io-client';

const socket = io('http://localhost:25578/werewolf');

socket.on('connect', () => {
  console.log('✅ Connected to Werewolf namespace');

  socket.emit('authenticate', {
    userId: 'test-user-1',
    username: 'TestPlayer'
  });
});

socket.on('room-created', (data) => {
  console.log('✅ Room created:', data.roomId);
});

socket.on('available-rooms', (rooms) => {
  console.log('✅ Available rooms:', rooms.length);
});

socket.emit('create-room', {
  userId: 'test-user-1',
  username: 'TestPlayer',
  config: { maxPlayers: 10 }
});
```

Exécuter :
```bash
node test-werewolf.js
```

## 🎯 Architecture Réseau

Le module Werewolf utilise un namespace Socket.IO séparé :

```
http://localhost:25578/          → Namespace principal (jeux existants)
http://localhost:25578/werewolf  → Namespace Werewolf (nouveau)
```

Cela permet :
- 🔒 Isolation logique des événements
- 📦 Pas d'interférence avec les jeux existants
- 🔄 Facilité de maintenance

## 📁 Structure Finale du Projet

```
flopobot_v2/
├── index.js                      # ← Modifié (init Werewolf)
├── src/
│   ├── server/
│   │   └── app.js                # ← Modifié (routes Werewolf)
│   ├── werewolf/                 # ← NOUVEAU MODULE
│   │   ├── models/
│   │   ├── managers/
│   │   ├── routes/
│   │   ├── socket/
│   │   ├── database/
│   │   ├── config/
│   │   ├── index.js
│   │   └── README.md
│   ├── game/                     # Jeux existants (poker, etc.)
│   ├── database/
│   │   └── index.js              # DB partagée
│   └── ...
└── flopobot.db                   # DB SQLite partagée
```

## 🔍 Logs à Surveiller

Au démarrage, vous devriez voir :

```
[Server] Initializing Werewolf module...
[Werewolf] Initializing game module...
[Werewolf] Database schema initialized successfully
[Werewolf] Seeded 7 achievements
[Werewolf] WebSocket handlers initialized
[Werewolf] Periodic tasks scheduled
[Werewolf] Recovering active games from database...
[Werewolf] No active games to recover
[Werewolf] Game module initialized successfully
[Server] Werewolf module initialized
```

## ⚠️ Points d'Attention

### 1. CORS Configuration

Si votre frontend Vue.js est sur un domaine différent, assurez-vous que le CORS inclut le namespace Werewolf :

```javascript
// Dans index.js
const io = new Server(server, {
  cors: {
    origin: FLAPI_URL,  // Déjà configuré
    methods: ["GET", "POST", "PUT", "OPTIONS"],
  }
});
```

### 2. Base de Données

Le module ajoute ~7 tables. Si vous voulez une DB séparée :

```javascript
// Option alternative : DB séparée
import Database from 'better-sqlite3';
const werewolfDB = new Database('./werewolf.db');

const { persistence } = initializeWerewolf(io, werewolfDB);
```

### 3. Ports et URLs

Le module utilise les mêmes ports que le serveur principal. Si vous utilisez un proxy inverse (nginx), ajoutez :

```nginx
location /werewolf/ {
    proxy_pass http://localhost:25578/werewolf/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## 🚀 Déploiement

### Développement

```bash
npm run dev  # Votre script existant
```

### Production

```bash
npm start
```

Le module Werewolf se lance automatiquement avec le serveur principal.

## 📊 Monitoring

Pour surveiller l'activité Werewolf :

```javascript
// Ajouter un endpoint de monitoring (optionnel)
app.get('/api/werewolf/health', (req, res) => {
  const stats = roomManager.getStats();
  res.json({
    status: 'ok',
    ...stats,
    uptime: process.uptime()
  });
});
```

## 🔄 Mises à Jour du Module

Le module est conçu pour être autonome. Les mises à jour futures n'affecteront que le dossier `src/werewolf/`.

## 🐛 Troubleshooting

### Problème : "Table already exists"

```javascript
// Le module gère déjà les migrations avec IF NOT EXISTS
// Aucune action requise
```

### Problème : WebSocket ne se connecte pas

```javascript
// Vérifier le namespace
const socket = io('http://localhost:25578/werewolf');  // ✅
// PAS
const socket = io('http://localhost:25578');  // ❌
```

### Problème : Les parties ne persistent pas

```javascript
// Vérifier que la DB est bien passée
console.log('[Debug] DB instance:', flopoDB);
console.log('[Debug] Werewolf persistence:', werewolfPersistence);
```

## ✅ Checklist d'Intégration

- [ ] Import du module dans `index.js`
- [ ] Appel de `initializeWerewolf(io, flopoDB)`
- [ ] Routes ajoutées dans `app.js`
- [ ] Serveur redémarré
- [ ] Test API REST fonctionne
- [ ] Test WebSocket fonctionne
- [ ] Tables créées dans la DB
- [ ] Achievements seedés
- [ ] Logs corrects dans la console

## 📞 Support

Si vous rencontrez des problèmes :

1. Vérifiez les logs avec le préfixe `[Werewolf]`
2. Testez l'API REST avant le WebSocket
3. Vérifiez que la DB est accessible
4. Consultez le [README.md](README.md) pour plus de détails

---

**Module créé pour FlopoBot v2**
Architecture séparée, infrastructure partagée ✨
