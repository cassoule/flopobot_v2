import { capitalize } from './utils.js';

export function getResult(p1, p2) {
  let gameResult;
  if (RPSChoices[p1.objectName] && RPSChoices[p1.objectName][p2.objectName]) {
    // o1 wins
    gameResult = {
      win: p1,
      lose: p2,
      verb: RPSChoices[p1.objectName][p2.objectName],
    };
  } else if (
    RPSChoices[p2.objectName] &&
    RPSChoices[p2.objectName][p1.objectName]
  ) {
    // o2 wins
    gameResult = {
      win: p2,
      lose: p1,
      verb: RPSChoices[p2.objectName][p1.objectName],
    };
  } else {
    // tie -- win/lose don't
    gameResult = { win: p1, lose: p2, verb: 'tie' };
  }

  return formatResult(gameResult);
}

function formatResult(result) {
  const { win, lose, verb } = result;
  return verb === 'tie'
    ? `<@${win.id}> and <@${lose.id}> draw with **${win.objectName}**`
    : `<@${win.id}>'s **${win.objectName}** ${verb} <@${lose.id}>'s **${lose.objectName}**`;
}

// this is just to figure out winner + verb
const RPSChoices = {
  rock: {
    description: 'sedimentary, igneous, or perhaps even metamorphic',
    virus: 'outwaits',
    computer: 'smashes',
    scissors: 'crushes',
  },
  cowboy: {
    description: 'yeehaw~',
    scissors: 'puts away',
    wumpus: 'lassos',
    rock: 'steel-toe kicks',
  },
  scissors: {
    description: 'careful ! sharp ! edges !!',
    paper: 'cuts',
    computer: 'cuts cord of',
    virus: 'cuts DNA of',
  },
  virus: {
    description: 'genetic mutation, malware, or something inbetween',
    cowboy: 'infects',
    computer: 'corrupts',
    wumpus: 'infects',
  },
  computer: {
    description: 'beep boop beep bzzrrhggggg',
    cowboy: 'overwhelms',
    paper: 'uninstalls firmware for',
    wumpus: 'deletes assets for',
  },
  wumpus: {
    description: 'the purple Discord fella',
    paper: 'draws picture on',
    rock: 'paints cute face on',
    scissors: 'admires own reflection in',
  },
  paper: {
    description: 'versatile and iconic',
    virus: 'ignores',
    cowboy: 'gives papercut to',
    rock: 'covers',
  },
};

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
    name: '1 journée',
    value: 86400,
  },
  {
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
  },
];

export function getRPSChoices() {
  return Object.keys(RPSChoices);
}

export function getTimesChoices() {
  return TimesChoices
}

// Function to fetch shuffled options for select menu
export function getShuffledOptions() {
  const allChoices = getRPSChoices();
  const options = [];

  for (let c of allChoices) {
    // Formatted for select menus
    // https://discord.com/developers/docs/interactions/message-components#select-menu-object-select-option-structure
    options.push({
      label: capitalize(c),
      value: c.toLowerCase(),
      description: RPSChoices[c]['description'],
    });
  }

  return options.sort(() => Math.random() - 0.5);
}
