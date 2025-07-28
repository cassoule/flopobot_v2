import 'dotenv/config';
import { getTimesChoices } from './game.js';
import { capitalize, InstallGlobalCommands } from './utils.js';

function createTimesChoices() {
  const choices = getTimesChoices();
  const commandChoices = [];

  for (let choice of choices) {
    commandChoices.push({
      name: capitalize(choice.name),
      value: choice.value?.toString(),
    });
  }

  return commandChoices;
}

// Simple test command
const TEST_COMMAND = {
  name: 'test',
  description: 'Basic command',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

// Timeout vote command
const TIMEOUT_COMMAND = {
  name: 'timeout',
  description: 'Vote démocratique pour timeout un boug',
  options: [
    {
      type: 6,
      name: 'akhy',
      description: 'Qui ?',
      required: true,
    },
    {
      type: 3,
      name: 'temps',
      description: 'Combien de temps ?',
      required: true,
      choices: createTimesChoices(),
    }
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 2],
}

// Valorant
const VALORANT_COMMAND = {
  name: 'valorant',
  description: `Ouvrir une caisse valorant (15€)`,
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 2],
}

// Own inventory command
const INVENTORY_COMMAND = {
  name: 'inventory',
  description: 'Voir inventaire',
  options: [
    {
      type: 6,
      name: 'akhy',
      description: 'Qui ?',
      required: false,
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 2],
}

const INFO_COMMAND = {
  name: 'info',
  description: 'Qui est time out ?',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 2],
}

const SKINS_COMMAND = {
  name: 'skins',
  description: 'Le top 10 des skins les plus chers.',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 2],
}

const SITE_COMMAND = {
  name: 'floposite',
  description: 'Lien vers FlopoSite',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 2],
}

const SEARCH_SKIN_COMMAND = {
  name: 'search',
  description: 'Chercher un skin',
  options: [
    {
      type: 3,
      name: 'recherche',
      description: 'Tu cherches quoi ?',
      required: true,
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 2],
}

const ALL_COMMANDS = [TIMEOUT_COMMAND, INVENTORY_COMMAND, VALORANT_COMMAND, INFO_COMMAND, SKINS_COMMAND, SEARCH_SKIN_COMMAND, SITE_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
