import { capitalize } from './utils.js';

import { updateUserCoins, getUser } from './init_database.js'

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

  if (msg.content.length < 3) return

  const now = Date.now();
  const timestamps = messagesTimestamps.get(author.id) || [];

  // Remove all timestamps if first one is older than 15 minutes
  const updatedTimestamps = now - timestamps[0] < 900000 ? timestamps : [];

  updatedTimestamps.push(now);
  messagesTimestamps.set(author.id, updatedTimestamps);

  if (messagesTimestamps.get(author.id).length <= 10) {
    // +10 or +50 coins
    updateUserCoins.run({
      id: author.id,
      coins: messagesTimestamps.get(author.id).length === 10
          ? authorDB.coins + 50
          : authorDB.coins + 10,
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