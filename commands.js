import 'dotenv/config';
import { getRPSChoices, getTimesChoices } from './game.js';
import { capitalize, InstallGlobalCommands } from './utils.js';

// Get the game choices from game.js
function createCommandChoices() {
  const choices = getRPSChoices();
  const commandChoices = [];

  for (let choice of choices) {
    commandChoices.push({
      name: capitalize(choice),
      value: choice.toLowerCase(),
    });
  }

  return commandChoices;
}

function createTimesChoices() {
  const choices = getTimesChoices();
  const commandChoices = [];

  for (let choice of choices) {
    commandChoices.push({
      name: capitalize(choice.name),
      value: choice.value.toString(),
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

// Command containing options
const CHALLENGE_COMMAND = {
  name: 'challenge',
  description: 'Challenge to a match of rock paper scissors',
  options: [
    {
      type: 3,
      name: 'object',
      description: 'Pick your object',
      required: true,
      choices: createCommandChoices(),
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 2],
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
  description: 'Ouvrir une caisse valorant',
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

const ALL_COMMANDS = [/*TEST_COMMAND, CHALLENGE_COMMAND, */TIMEOUT_COMMAND, INVENTORY_COMMAND, VALORANT_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
