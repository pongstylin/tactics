import Bot from '#tactics/Bot.js';
import BotChaos from '#tactics/BotChaos.js';

export default function (subclass, state, team) {
  if (subclass === 'Chaos')
    return new BotChaos(state, team);

  return new Bot(state, team);
}
