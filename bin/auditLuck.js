import fs from 'fs';

import seedrandom from 'seedrandom';

import '#plugins/index.js';
import GameAdapter from '#data/FileAdapter/GameAdapter.js';

const dataAdapter = new GameAdapter();
const gameId = process.argv[2];

auditGame(gameId);

async function auditGame(gameId) {
  const game = await dataAdapter._getGame(gameId);
  const csv = fs.createWriteStream(`auditLuck_${gameId}.csv`);

  csv.write(`\ufeff"Team","Turn","Result","Chance-To-Hit","Random","Bias"\n`);

  try {
    for (const team of game.state.teams) {
      const random = {
        generate: seedrandom("", { state:team.data.randomState.data.initial }),
        count: 0,
        sum: 0,
      };
      const count = team.data.randomState.data.count;

      for (const [ turnId, turn ] of game.state.turns.entries()) {
        if (turnId % game.state.teams.length !== team.id)
          continue;

        const attack = turn.actions.find(a => a.type === 'attack');
        if (!attack)
          continue;

        for (const result of attack.results) {
          if (!result.luck)
            continue;

          const luck = result.luck;

          while (luck.id < (random.count + 1)) {
            const number = random.generate() * 100;
            random.count++;
            random.sum += number;

            csv.write(`"${team.name}","?","Undo","?","${number}","${random.sum / random.count}"\n`);
          }

          const expectedNumber = random.generate() * 100;
          random.count++;
          random.sum += expectedNumber;
          const actualNumber = luck.number;
          const expectedResult = expectedNumber < luck.chance ? 'Hit' : 'Block';
          const actualResult = result.miss === 'blocked' ? 'Block' : 'Hit';

          if (expectedNumber !== actualNumber)
            throw new Error(`Wrong number: ${expectedNumber} !== ${actualNumber}`);
          else if (expectedResult !== actualResult)
            throw new Error(`Wrong result: ${expectedResult} !== ${actualResult}`);

          csv.write(`"${team.name}","${turnId}","${expectedResult}","${luck.chance}","${expectedNumber}",${random.sum / random.count}\n`);
        }
      }

      while (random.count < 100) {
        const number = random.generate() * 100;
        random.count++;
        random.sum += number;

        csv.write(`"${team.name}","?","Unused","?","${number}",${random.sum / random.count}\n`);
      }
    }
  } catch (e) {
    console.log(e);
    csv.close();
  }
};

