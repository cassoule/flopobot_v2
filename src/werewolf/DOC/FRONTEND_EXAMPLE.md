# Frontend Vue.js + Three.js - Exemples d'Intégration

Guide pour créer le frontend de Werewolf avec Vue.js et Three.js.

## 🎨 Stack Recommandée

- **Vue 3** avec Composition API
- **Three.js** pour le rendu 3D
- **Socket.IO Client** pour le WebSocket
- **Pinia** pour la gestion d'état (optionnel)
- **TresJS** ou **vue-three** pour intégrer Three.js avec Vue (optionnel)

## 📦 Installation

```bash
npm install socket.io-client three @vueuse/core
# Optionnel pour simplifier l'intégration Three.js
npm install @tresjs/core @tresjs/cientos
```

## 🔌 Composable Socket.IO

```javascript
// composables/useWerewolf.js
import { ref, onMounted, onUnmounted } from 'vue'
import { io } from 'socket.io-client'

export function useWerewolf() {
  const socket = ref(null)
  const roomState = ref(null)
  const myPlayer = ref(null)
  const availableRooms = ref([])
  const chatMessages = ref([])
  const isConnected = ref(false)
  const error = ref(null)

  const connect = (userId, username) => {
    socket.value = io('http://localhost:25578/werewolf', {
      transports: ['websocket']
    })

    socket.value.on('connect', () => {
      isConnected.value = true
      console.log('✅ Connected to Werewolf server')

      // Authentification
      socket.value.emit('authenticate', { userId, username })
    })

    socket.value.on('disconnect', () => {
      isConnected.value = false
      console.log('❌ Disconnected from server')
    })

    socket.value.on('error', (err) => {
      error.value = err.message
      console.error('Socket error:', err)
    })

    // Événements de salle
    socket.value.on('room-state', (state) => {
      roomState.value = state
      myPlayer.value = state.myPlayer
    })

    socket.value.on('room-created', (data) => {
      roomState.value = data.state
      myPlayer.value = data.state.myPlayer
    })

    socket.value.on('room-joined', (data) => {
      roomState.value = data.state
      myPlayer.value = data.state.myPlayer
    })

    socket.value.on('available-rooms', (rooms) => {
      availableRooms.value = rooms
    })

    socket.value.on('player-joined', (data) => {
      console.log(`${data.username} joined`)
    })

    socket.value.on('player-left', (data) => {
      console.log(`${data.username} left`)
    })

    // Événements de jeu
    socket.value.on('game-started', (data) => {
      console.log('🎮 Game started!', data)
    })

    socket.value.on('phase-changed', (data) => {
      console.log(`🌙 Phase: ${data.phase}, Turn: ${data.turn}`)
    })

    socket.value.on('deaths-occurred', (data) => {
      console.log('💀 Deaths:', data.deaths)
    })

    // Chat
    socket.value.on('chat-message', (msg) => {
      chatMessages.value.push(msg)
    })

    // Voyante
    socket.value.on('seer-vision', (data) => {
      console.log(`👁️ Vision: ${data.target} is ${data.role}`)
    })
  }

  const disconnect = () => {
    if (socket.value) {
      socket.value.disconnect()
      socket.value = null
    }
  }

  const createRoom = (config = {}) => {
    if (!socket.value || !isConnected.value) return

    socket.value.emit('create-room', {
      userId: myPlayer.value?.userId,
      username: myPlayer.value?.username,
      config
    })
  }

  const joinRoom = (roomId) => {
    if (!socket.value || !isConnected.value) return

    socket.value.emit('join-room', {
      roomId,
      userId: myPlayer.value?.userId,
      username: myPlayer.value?.username
    })
  }

  const leaveRoom = () => {
    if (!socket.value || !roomState.value) return

    socket.value.emit('leave-room', {
      roomId: roomState.value.roomId,
      userId: myPlayer.value?.userId
    })

    roomState.value = null
    myPlayer.value = null
  }

  const toggleReady = () => {
    if (!socket.value || !roomState.value) return

    socket.value.emit('toggle-ready', {
      roomId: roomState.value.roomId,
      userId: myPlayer.value?.userId
    })
  }

  const startGame = () => {
    if (!socket.value || !roomState.value) return

    socket.value.emit('start-game', {
      roomId: roomState.value.roomId,
      userId: myPlayer.value?.userId
    })
  }

  const performNightAction = (abilityId, targets) => {
    if (!socket.value || !roomState.value) return

    socket.value.emit('night-action', {
      roomId: roomState.value.roomId,
      userId: myPlayer.value?.userId,
      abilityId,
      targets
    })
  }

  const vote = (targetId) => {
    if (!socket.value || !roomState.value) return

    socket.value.emit('vote', {
      roomId: roomState.value.roomId,
      userId: myPlayer.value?.userId,
      targetId
    })
  }

  const sendChatMessage = (message, channel = 'all') => {
    if (!socket.value || !roomState.value) return

    socket.value.emit('chat-message', {
      roomId: roomState.value.roomId,
      userId: myPlayer.value?.userId,
      channel,
      message
    })
  }

  const useItem = (itemId, targets) => {
    if (!socket.value || !roomState.value) return

    socket.value.emit('use-item', {
      roomId: roomState.value.roomId,
      userId: myPlayer.value?.userId,
      itemId,
      targets
    })
  }

  onUnmounted(() => {
    disconnect()
  })

  return {
    socket,
    isConnected,
    roomState,
    myPlayer,
    availableRooms,
    chatMessages,
    error,
    connect,
    disconnect,
    createRoom,
    joinRoom,
    leaveRoom,
    toggleReady,
    startGame,
    performNightAction,
    vote,
    sendChatMessage,
    useItem
  }
}
```

## 🎮 Composant Lobby

```vue
<!-- components/WerewolfLobby.vue -->
<template>
  <div class="werewolf-lobby">
    <h1>Loup-Garou - Lobby</h1>

    <!-- Liste des salles disponibles -->
    <div v-if="!roomState" class="rooms-list">
      <h2>Parties Disponibles</h2>
      <button @click="createRoom">Créer une Partie</button>

      <div v-for="room in availableRooms" :key="room.roomId" class="room-card">
        <h3>Salle {{ room.roomId }}</h3>
        <p>Hôte: {{ room.hostUsername }}</p>
        <p>Joueurs: {{ room.playerCount }}/{{ room.maxPlayers }}</p>
        <button @click="joinRoom(room.roomId)">Rejoindre</button>
      </div>
    </div>

    <!-- Salle en attente -->
    <div v-else-if="!roomState.isStarted" class="waiting-room">
      <h2>Salle {{ roomState.roomId }}</h2>
      <p>En attente de {{ roomState.config.minPlayers - roomState.players.length }} joueur(s)...</p>

      <div class="players-list">
        <div
          v-for="player in roomState.players"
          :key="player.userId"
          class="player-item"
          :class="{ ready: player.isReady, host: player.isHost }"
        >
          <span>{{ player.username }}</span>
          <span v-if="player.isHost">👑</span>
          <span v-if="player.isReady">✅</span>
        </div>
      </div>

      <button @click="toggleReady">
        {{ myPlayer?.isReady ? 'Pas Prêt' : 'Prêt' }}
      </button>

      <button v-if="myPlayer?.isHost" @click="startGame" :disabled="!canStart">
        Démarrer la Partie
      </button>

      <button @click="leaveRoom">Quitter</button>
    </div>

    <!-- Partie en cours -->
    <GameBoard v-else :room-state="roomState" :my-player="myPlayer" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useWerewolf } from '@/composables/useWerewolf'
import GameBoard from './GameBoard.vue'

const {
  roomState,
  myPlayer,
  availableRooms,
  createRoom,
  joinRoom,
  leaveRoom,
  toggleReady,
  startGame
} = useWerewolf()

const canStart = computed(() => {
  if (!roomState.value) return false
  const readyPlayers = roomState.value.players.filter(p => p.isReady || p.isHost)
  return readyPlayers.length >= roomState.value.config.minPlayers
})
</script>

<style scoped>
.werewolf-lobby {
  padding: 2rem;
}

.rooms-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
  margin-top: 2rem;
}

.room-card {
  background: #2a2a2a;
  padding: 1rem;
  border-radius: 8px;
  border: 2px solid #444;
}

.players-list {
  margin: 2rem 0;
}

.player-item {
  padding: 0.5rem;
  margin: 0.5rem 0;
  background: #333;
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
}

.player-item.ready {
  background: #2d5016;
}

.player-item.host {
  border: 2px solid gold;
}
</style>
```

## 🎨 Composant GameBoard avec Three.js

```vue
<!-- components/GameBoard.vue -->
<template>
  <div class="game-board">
    <!-- Informations de phase -->
    <div class="game-info">
      <h2>{{ phaseText }}</h2>
      <p>Tour {{ roomState.turn }}</p>
      <p>Temps restant: {{ timeRemaining }}s</p>
    </div>

    <!-- Scène 3D -->
    <div ref="threeContainer" class="three-container"></div>

    <!-- Interface d'action -->
    <div class="action-panel">
      <!-- Phase Nuit -->
      <div v-if="roomState.phase === 'night' && canAct">
        <h3>{{ myPlayer.role }} - Choisissez votre cible</h3>
        <PlayerSelector
          :players="selectablePlayers"
          @select="handleNightAction"
        />
      </div>

      <!-- Phase Vote -->
      <div v-else-if="roomState.phase === 'voting' && canAct">
        <h3>Votez pour éliminer un joueur</h3>
        <PlayerSelector
          :players="alivePlayers"
          @select="handleVote"
        />
      </div>
    </div>

    <!-- Chat -->
    <ChatPanel
      :messages="chatMessages"
      :channels="myPlayer.chatChannels"
      @send="sendChatMessage"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

const props = defineProps({
  roomState: Object,
  myPlayer: Object
})

const emit = defineEmits(['night-action', 'vote', 'chat-message'])

const threeContainer = ref(null)
let scene, camera, renderer, controls
let playerMeshes = []

// ===== THREE.JS SETUP =====

onMounted(() => {
  initThreeScene()
  animate()
})

onUnmounted(() => {
  if (renderer) {
    renderer.dispose()
  }
})

watch(() => props.roomState.players, () => {
  updatePlayerPositions()
}, { deep: true })

function initThreeScene() {
  // Scène
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e)

  // Caméra
  camera = new THREE.PerspectiveCamera(
    75,
    threeContainer.value.clientWidth / threeContainer.value.clientHeight,
    0.1,
    1000
  )
  camera.position.set(0, 10, 15)

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(
    threeContainer.value.clientWidth,
    threeContainer.value.clientHeight
  )
  threeContainer.value.appendChild(renderer.domElement)

  // Contrôles
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  // Lumières
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
  scene.add(ambientLight)

  const pointLight = new THREE.PointLight(0xffffff, 1)
  pointLight.position.set(0, 10, 0)
  scene.add(pointLight)

  // Table centrale
  const tableGeometry = new THREE.CylinderGeometry(8, 8, 0.5, 32)
  const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 })
  const table = new THREE.Mesh(tableGeometry, tableMaterial)
  scene.add(table)

  // Créer les joueurs
  updatePlayerPositions()
}

function updatePlayerPositions() {
  // Supprimer les anciens meshes
  playerMeshes.forEach(mesh => scene.remove(mesh))
  playerMeshes = []

  const players = props.roomState.players
  const radius = 10
  const angleStep = (Math.PI * 2) / players.length

  players.forEach((player, index) => {
    const angle = index * angleStep
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius

    // Créer le personnage
    const geometry = new THREE.CapsuleGeometry(0.5, 2, 4, 8)
    const material = new THREE.MeshStandardMaterial({
      color: player.isAlive ? (player.team === 'werewolves' ? 0xff0000 : 0x00ff00) : 0x666666,
      emissive: player.userId === props.myPlayer.userId ? 0xffff00 : 0x000000,
      emissiveIntensity: 0.3
    })

    const playerMesh = new THREE.Mesh(geometry, material)
    playerMesh.position.set(x, 1, z)
    playerMesh.userData = { player }

    // Rotation vers le centre
    playerMesh.lookAt(0, 1, 0)

    scene.add(playerMesh)
    playerMeshes.push(playerMesh)

    // Ajouter un label (nom)
    createTextLabel(player.username, x, 3, z)
  })
}

function createTextLabel(text, x, y, z) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  canvas.width = 256
  canvas.height = 64

  context.fillStyle = 'white'
  context.font = 'Bold 24px Arial'
  context.textAlign = 'center'
  context.fillText(text, 128, 40)

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture })
  const sprite = new THREE.Sprite(material)

  sprite.position.set(x, y, z)
  sprite.scale.set(2, 0.5, 1)

  scene.add(sprite)
}

function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

// ===== GAME LOGIC =====

const phaseText = computed(() => {
  const phases = {
    night: '🌙 Phase de Nuit',
    day: '☀️ Phase de Discussion',
    voting: '🗳️ Phase de Vote',
    ended: '🏁 Partie Terminée'
  }
  return phases[props.roomState.phase] || ''
})

const timeRemaining = computed(() => {
  if (!props.roomState.phaseEndTime) return 0
  return Math.max(0, Math.floor((props.roomState.phaseEndTime - Date.now()) / 1000))
})

const canAct = computed(() => {
  return props.myPlayer.isAlive && !props.myPlayer.isSilenced
})

const alivePlayers = computed(() => {
  return props.roomState.players.filter(p => p.isAlive)
})

const selectablePlayers = computed(() => {
  // Selon le rôle, filtrer les cibles possibles
  if (props.myPlayer.team === 'werewolves') {
    return alivePlayers.value.filter(p => p.team !== 'werewolves')
  }
  return alivePlayers.value.filter(p => p.userId !== props.myPlayer.userId)
})

function handleNightAction(targetId) {
  const ability = props.myPlayer.role.abilities.find(a => a.type === 'night')
  if (!ability) return

  emit('night-action', ability.id, [targetId])
}

function handleVote(targetId) {
  emit('vote', targetId)
}
</script>

<style scoped>
.game-board {
  display: grid;
  grid-template-columns: 1fr 300px;
  grid-template-rows: auto 1fr;
  height: 100vh;
  gap: 1rem;
  padding: 1rem;
}

.game-info {
  grid-column: 1 / -1;
  background: #2a2a2a;
  padding: 1rem;
  border-radius: 8px;
}

.three-container {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  overflow: hidden;
}

.action-panel {
  background: #2a2a2a;
  padding: 1rem;
  border-radius: 8px;
  overflow-y: auto;
}
</style>
```

## 🎯 Utilisation dans App.vue

```vue
<template>
  <div id="app">
    <WerewolfLobby v-if="isAuthenticated" />
    <Login v-else @login="handleLogin" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useWerewolf } from '@/composables/useWerewolf'
import WerewolfLobby from '@/components/WerewolfLobby.vue'
import Login from '@/components/Login.vue'

const { connect } = useWerewolf()
const isAuthenticated = ref(false)

function handleLogin(userId, username) {
  connect(userId, username)
  isAuthenticated.value = true
}

onMounted(() => {
  // Récupérer l'userId depuis localStorage ou votre système d'auth
  const savedUserId = localStorage.getItem('userId')
  const savedUsername = localStorage.getItem('username')

  if (savedUserId && savedUsername) {
    handleLogin(savedUserId, savedUsername)
  }
})
</script>
```

## 🎨 Effets Three.js Avancés

### Animation de Mort

```javascript
function animateDeath(playerMesh) {
  const startY = playerMesh.position.y
  const duration = 1000
  const startTime = Date.now()

  function animate() {
    const elapsed = Date.now() - startTime
    const progress = Math.min(elapsed / duration, 1)

    // Tombe au sol
    playerMesh.position.y = startY - (startY * progress)
    playerMesh.rotation.x = progress * Math.PI / 2

    // Fade out
    playerMesh.material.opacity = 1 - progress
    playerMesh.material.transparent = true

    if (progress < 1) {
      requestAnimationFrame(animate)
    }
  }

  animate()
}
```

### Effet de Protection

```javascript
function addProtectionShield(playerMesh) {
  const geometry = new THREE.SphereGeometry(1, 32, 32)
  const material = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.3,
    wireframe: true
  })

  const shield = new THREE.Mesh(geometry, material)
  playerMesh.add(shield)

  // Animation de rotation
  function animate() {
    shield.rotation.y += 0.01
    requestAnimationFrame(animate)
  }
  animate()

  return shield
}
```

## 📱 Version Mobile

Pour une version responsive :

```vue
<script setup>
import { useMediaQuery } from '@vueuse/core'

const isMobile = useMediaQuery('(max-width: 768px)')
</script>

<template>
  <div :class="{ mobile: isMobile }">
    <!-- Layout adaptatif -->
  </div>
</template>
```

---

Ce guide fournit une base solide pour créer un frontend immersif. Adaptez-le selon vos besoins!
