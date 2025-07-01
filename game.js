import { capitalize } from './utils.js';
import pkg from 'pokersolver';
const { Hand } = pkg;

import {
  updateUserCoins,
  getUser,
  insertLog,
  insertGame,
  getUserElo,
  insertElos,
  updateElo,
  getAllSkins
} from './init_database.js'
import {skins} from "./index.js";

const messagesTimestamps = new Map();

const TimesChoices = [
  {
    name: '1 minute',
    value: 60,
  },
  {
    name: '5 minutes',
    value: 300,
  },
  {
    name: '10 minutes',
    value: 600,
  },
  {
    name: '15 minutes',
    value: 900,
  },
  {
    name: '30 minutes',
    value: 1800,
  },
  {
    name: '1 heure',
    value: 3600,
  },
  {
    name: '2 heures',
    value: 3600,
  },
  {
    name: '3 heures',
    value: 10800,
  },
  {
    name: '6 heures',
    value: 21600,
  },
  {
    name: '9 heures',
    value: 32400,
  },
  {
    name: '12 heures',
    value: 43200,
  },
  {
    name: '16 heures',
    value: 57600,
  },
  {
    name: '1 jour',
    value: 86400,
  },
  /*{
    name: '2 journées',
    value: 172800,
  },
  {
    name: '1 semaine',
    value: 604800,
  },
  {
    name: '2 semaines',
    value: 604800 * 2,
  },*/
];

export function getTimesChoices() {
  return TimesChoices
}

export function channelPointsHandler(msg) {
  const author = msg.author
  const authorDB = getUser.get(author.id)

  if (!authorDB) {
    console.log("message from an unknown user")
    return
  }

  if (msg.content.length < 3 || msg.content.startsWith('.')) return

  const now = Date.now();
  const timestamps = messagesTimestamps.get(author.id) || [];

  // Remove all timestamps if first one is older than 15 minutes
  const updatedTimestamps = now - timestamps[0] < 900000 ? timestamps : [];

  updatedTimestamps.push(now);
  messagesTimestamps.set(author.id, updatedTimestamps);

  if (messagesTimestamps.get(author.id).length <= 10) {
    // +10 or +50 coins
    let coins = messagesTimestamps.get(author.id).length === 10
            ? 50
            : 10
    updateUserCoins.run({
      id: author.id,
      coins: authorDB.coins + coins,
    })
    insertLog.run({
      id: author.id + '-' + Date.now(),
      user_id: author.id,
      action: 'AUTOCOINS',
      target_user_id: null,
      coins_amount: coins,
      user_new_amount: authorDB.coins + coins,
    })
  }
}

export async function slowmodesHandler(msg, activeSlowmodes) {
  const author = msg.author
  const authorDB = getUser.get(author.id)
  const authorSlowmode = activeSlowmodes[author.id]

  if (!authorDB) return false
  if (!authorSlowmode) return false

  console.log('Message from a slowmode user')

  const now = Date.now();
  if (now > authorSlowmode.endAt) {
    console.log('Slow mode is over')
    delete activeSlowmodes[author.id]
    return true
  }

  if (authorSlowmode.lastMessage && (authorSlowmode.lastMessage + 60 * 1000) > now) {
    await msg.delete()
    console.log('Message deleted')
  } else {
    authorSlowmode.lastMessage = Date.now()
  }
  return false
}

export async function eloHandler(p1, p2, p1score, p2score, type) {
  const p1DB = getUser.get(p1)
  const p2DB = getUser.get(p2)

  if (!p1DB || !p2DB) return

  let p1elo = await getUserElo.get({ id: p1 })
  let p2elo = await getUserElo.get({ id: p2 })

  if (!p1elo) {
    await insertElos.run({
      id: p1.toString(),
      elo: 100,
    })
    p1elo = await getUserElo.get({ id: p1 })
  }
  if (!p2elo) {
    await insertElos.run({
      id: p2.toString(),
      elo: 100,
    })
    p2elo = await getUserElo.get({ id: p2 })
  }

  if (p1score === p2score) {
    insertGame.run({
      id: p1.toString() + '-' + p2.toString() + '-' + Date.now().toString(),
      p1: p1,
      p2: p2,
      p1_score: p1score,
      p2_score: p2score,
      p1_elo: p1elo.elo,
      p2_elo: p2elo.elo,
      p1_new_elo: p1elo.elo,
      p2_new_elo: p2elo.elo,
      type: type,
      timestamp: Date.now(),
    })
    return
  }

  const prob1 = 1 / (1 + Math.pow(10, (p2elo.elo - p1elo.elo)/400))
  const prob2 = 1 / (1 + Math.pow(10, (p1elo.elo - p2elo.elo)/400))

  const p1newElo = Math.max(Math.floor(p1elo.elo + 10 * (p1score - prob1)), 0)
  const p2newElo = Math.max(Math.floor(p2elo.elo + 10 * (p2score - prob2)), 0)

  console.log(`${p1} elo update : ${p1elo.elo} -> ${p1newElo}`)
  console.log(`${p2} elo update : ${p2elo.elo} -> ${p2newElo}`)
  updateElo.run({ id: p1, elo: p1newElo })
  updateElo.run({ id: p2, elo: p2newElo })

  insertGame.run({
    id: p1.toString() + '-' + p2.toString() + '-' + Date.now().toString(),
    p1: p1,
    p2: p2,
    p1_score: p1score,
    p2_score: p2score,
    p1_elo: p1elo.elo,
    p2_elo: p2elo.elo,
    p1_new_elo: p1newElo,
    p2_new_elo: p2newElo,
    type: type,
    timestamp: Date.now(),
  })
}

export function pokerTest() {
  console.log('pokerTest')
  let hand1 = Hand.solve(['Ad', 'As', 'Jc', 'Th', '2d', '3c', 'Kd'], 'standard', false);
  //let hand2 = Hand.solve(['Ad', 'As', 'Jc', 'Th', '2d', '3c', 'Kd'], 'standard', false);
  let hand2 = Hand.solve(['Ad', 'As', 'Jc', 'Th', '2d', 'Qs', 'Qd'], 'standard', false);
  /*console.log(hand1.name)
  console.log(hand2.name)
  console.log(hand1.descr)
  console.log(hand2.descr)*/
  console.log(hand1.toString())
  console.log(hand2.toString())

  let winner = Hand.winners([hand1, hand2]); // hand2
  console.log(winner)
  console.log(winner.includes(hand1));
  console.log(winner.includes(hand2));
}

export async function pokerEloHandler(room) {
  let DBplayers = []
  Object.keys(room.players).forEach(playerId => {
    const DBuser = getUser.get(playerId)
    if (DBuser) {
      DBplayers.push(DBuser)
    }
  })

  const winnerIds = new Set(room.winners)
  const baseK = 5
  const playerCount = Object.keys(room.players).length
  const K = baseK * Math.log2(playerCount)

  DBplayers.forEach(player => {
    const others = DBplayers.filter(p => p.id !== player.id)
    const avgOppElo = others.reduce((sum, p) => sum + p.elo, 0) / others.length

    const expectedScore = 1 / (1 + Math.pow(10, (avgOppElo - player.elo) / 400))
    let actualScore;

    if (winnerIds.has(player.id)) {
      if (winnerIds.size === DBplayers.length) {
        actualScore = 0.5
      } else {
        actualScore = 1
      }
    } else {
      actualScore = 0
    }

    const delta = K * (actualScore - expectedScore)
    const newElo = Math.max(Math.floor(player.elo + delta), 0)

    console.log(`${player.id} elo update : ${player.elo} -> ${newElo} (K: ${K})`)
    updateElo.run({ id: player.id, elo: newElo })

    insertGame.run({
      id: player.id + '-' + Date.now().toString(),
      p1: player.id,
      p2: null,
      p1_score: actualScore,
      p2_score: null,
      p1_elo: player.elo,
      p2_elo: avgOppElo,
      p1_new_elo: newElo,
      p2_new_elo: null,
      type: 'POKER_ROUND',
      timestamp: Date.now(),
    })
  })
}

export function randomSkinPrice(id=0) {
  const dbSkins = getAllSkins.all();
  const randomIndex = Math.floor(Math.random() * dbSkins.length);
  let randomSkin = skins.find((skin) => skin.uuid === dbSkins[randomIndex].uuid);

  // Generate random level and chroma
  const randomLevel = Math.floor(Math.random() * randomSkin.levels.length + 1);
  let randomChroma = randomLevel === randomSkin.levels.length
      ? Math.floor(Math.random() * randomSkin.chromas.length + 1)
      : 1;
  if (randomChroma === randomSkin.chromas.length && randomSkin.chromas.length >= 2) randomChroma--
  const selectedLevel = randomSkin.levels[randomLevel - 1]
  const selectedChroma = randomSkin.chromas[randomChroma - 1]


  // Helper functions (unchanged from your original code)
  const price = () => {
    let result = dbSkins[randomIndex].basePrice;

    result *= (1 + (randomLevel / Math.max(randomSkin.levels.length, 2)))
    result *= (1 + (randomChroma / 4))

    return result.toFixed(2);
  }

  const returnPrice = price()
  console.log(`#${id} :`, returnPrice)
  return returnPrice
}