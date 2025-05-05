import { capitalize } from './utils.js';

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
  console.log(msg.createdTimestamp)
  const author = msg.author

  const now = Date.now();
  const timestamps = messagesTimestamps.get(author.id) || [];

  // Remove timestamps older than SPAM_INTERVAL seconds
  const updatedTimestamps = timestamps.filter(ts => now - ts < 300000); // 5 minutes

  updatedTimestamps.push(now);
  messagesTimestamps.set(author.id, updatedTimestamps);

  if (messagesTimestamps.get(author.id).length === 1) {
    // +50 coins
  } else if (messagesTimestamps.get(author.id).length <= 5) {
    // +10 coins
  }
}
