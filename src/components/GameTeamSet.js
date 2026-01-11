import 'components/GameTeamSet.scss';
import { gameConfig } from 'config/client.js';

const getDetails = (gameType, set) => {
  const details = [];

  if (!gameType.isCustomizable)
    details.push(`<DIV class="name">(Not Customizable)</DIV>`);
  else if (set.name !== undefined)
    details.push(`<DIV class="name">${set.name}</DIV>`);
  if (set.stats) {
    if (set.stats.rank)
      details.push(`<DIV class="rating">Rating: ${set.stats.rating} #${set.stats.rank}</DIV>`);
    else if (set.stats.rating)
      details.push(`<DIV class="rating">Rating: ${set.stats.rating}</DIV>`);
    else
      details.push(`<DIV class="unrated">Unrated</DIV>`);
    details.push(`<DIV class="gameCount">Games: ${set.stats.gameCount}</DIV>`);
    details.push(`<DIV class="playerCount">Players: ${set.stats.playerCount}</DIV>`);
  } else if (set.units.length)
    details.push(`<DIV class="new">New!</DIV>`);

  return details.join('');
};

export const renderSet = (gameType = null, set = null) => {
  const divSet = document.createElement('DIV');
  divSet.classList.add('component');
  divSet.classList.add('gameTeamSet');

  const divDetails = document.createElement('DIV');
  divDetails.classList.add('details');
  divSet.appendChild(divDetails);

  const divImage = document.createElement('DIV');
  divImage.classList.add('image');
  divSet.appendChild(divImage);

  divSet.component = {
    reset: async (gameType, set) => {
      divSet.dataset.id = set ? set.id : '';
      divDetails.innerHTML = set ? getDetails(gameType, set) : '';

      const rotation = gameConfig.rotation;
      divSet.classList.toggle('rotation-N', rotation === 'N');
      divSet.classList.toggle('rotation-S', rotation === 'S');
      divSet.classList.toggle('rotation-E', rotation === 'E');
      divSet.classList.toggle('rotation-W', rotation === 'W');
      if (set)
        divImage.style.backgroundImage = `url(${await Tactics.getSetImage(gameType, set)})`;
    },
  };
  if (gameType && set) divSet.component.reset(gameType, set);

  return divSet;
}
