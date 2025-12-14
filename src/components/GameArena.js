import whenTransitionEnds from 'components/whenTransitionEnds.js';

await Tactics.load([ 'avatars' ]);
const avatarsSprite = Tactics.getSprite('avatars');
const arena = avatarsSprite.getImage('arena');

export const avatars = new Map();
export const arenaGameSummary = new WeakMap();
export const fetchAvatars = async playerIds => {
  const newPlayerIds = Array.from(new Set(playerIds.filter(pId => !avatars.has(pId))));

  if (newPlayerIds.length) {
    const playerAvatars = await Tactics.gameClient.getPlayersAvatar(newPlayerIds);
    for (let i = 0; i < newPlayerIds.length; i++)
      avatars.set(newPlayerIds[i], playerAvatars[i]);
  }
}
export const getAvatar = (playerId, options = {}) => {
  const avatar = avatars.get(playerId);

  return Tactics.drawAvatar(avatar, { direction:'S', withShadow:true, ...options });
};

export function renderArena(index) {
  const divArena = document.createElement('DIV');
  divArena.classList.add('arena');
  divArena.classList.add('empty');
  divArena.dataset.index = index;

  const shpArena = document.createElement('DIV');
  shpArena.classList.add('arena-shape');
  shpArena.addEventListener('mouseenter', () => {
    if (divArena.classList.contains('disabled'))
      return;

    avatarsSprite.getSound('focus').howl.play();
  });
  divArena.appendChild(shpArena);

  const imgArena = document.createElement('IMG');
  imgArena.classList.add('arena-image');
  imgArena.src = arena.src;
  shpArena.appendChild(imgArena);

  const btnJoin = document.createElement('IMG');
  btnJoin.classList.add('arena-button-bottom');
  btnJoin.src = '/arenaJoin.svg';
  shpArena.appendChild(btnJoin);

  const avatarTop = document.createElement('IMG');
  avatarTop.classList.add('unit');
  avatarTop.classList.add('top');
  shpArena.appendChild(avatarTop);

  const avatarBtm = document.createElement('IMG');
  avatarBtm.classList.add('unit');
  avatarBtm.classList.add('btm');
  shpArena.appendChild(avatarBtm);

  const nameTop = document.createElement('SPAN');
  nameTop.classList.add('name');
  nameTop.classList.add('top');
  shpArena.appendChild(nameTop);

  const nameBtm = document.createElement('SPAN');
  nameBtm.classList.add('name');
  nameBtm.classList.add('btm');
  shpArena.appendChild(nameBtm);

  const divLabel = document.createElement('DIV');
  divLabel.classList.add('labels');
  shpArena.appendChild(divLabel);

  return divArena;
}
function hideArena(divArena) {
  if (divArena.classList.contains('hide'))
    return false;

  divArena.classList.add('hide');
  return emptyArena(divArena);
}
/*
 * When disabled it true, it means empty or non-started arenas should be disabled.
 * Only true for lobby arenas when a started lobby game exists for the logged-in player.
 */
export async function fillArena(divArena, arena = true, disabled = false) {
  if (arena === false)
    return hideArena(divArena);

  divArena.classList.remove('hide');
  if (arena === true)
    return emptyArena(divArena, disabled);

  await fetchAvatars(arena.teams.filter(t => !!t).map(t => t.playerId));

  const oldArena = arenaGameSummary.get(divArena) ?? null;
  if (arena === oldArena)
    return false;

  arenaGameSummary.set(divArena, arena);
  divArena.classList.remove('empty');
  divArena.classList.toggle('waiting', !arena.startedAt);
  divArena.classList.toggle('active', !!arena.startedAt && !arena.endedAt);
  divArena.classList.toggle('complete', !!arena.endedAt);

  divArena.classList.add('disabled');
  if (oldArena && oldArena.id !== arena.id) {
    await Promise.all([
      fillTeam(divArena, 'top', null, oldArena),
      fillTeam(divArena, 'btm', null, oldArena),
    ]);
    await Promise.all([
      fillTeam(divArena, 'top', arena, null),
      fillTeam(divArena, 'btm', arena, null),
    ]);
  } else {
    await Promise.all([
      fillTeam(divArena, 'top', arena, oldArena),
      fillTeam(divArena, 'btm', arena, oldArena),
    ]);
  }
  divArena.classList.toggle('disabled', disabled && !arena?.startedAt && (!arena || arena.collection?.startsWith('lobby/')));

  const labels = [];
  if (!arena.startedAt) {
    if (arena.randomHitChance === false)
      labels.push('No Luck');
    if (arena.rated === true)
      labels.push('Rated');
    else if (arena.rated === false && Tactics.authClient.isVerified && arena.mode !== 'practice')
      labels.push('Unrated');
    if (arena.mode)
      labels.push(arena.mode.toUpperCase('first'));
    if (arena.timeLimitName && arena.timeLimitName !== 'standard')
      labels.push(arena.timeLimitName.toUpperCase('first'));
  }

  const divLabels = divArena.querySelector('.labels');
  divLabels.innerHTML = '';

  for (const label of labels) {
    const divLabel = document.createElement('DIV');
    divLabel.classList.add('label');
    divLabel.textContent = label;
    divLabels.append(divLabel);
  }
}
async function fillTeam(divArena, slot, arena, oldArena) {
  const spnName = divArena.querySelector(`.name.${slot}`);
  const imgUnit = divArena.querySelector(`.unit.${slot}`);

  /*
   * My team, if present, must be on bottom else the creator team must be on top.
   */
  const oldTeam = oldArena && (() => {
    const myIndex = oldArena.teams.findIndex(t => t?.playerId === Tactics.authClient.playerId);
    const creatorIndex = oldArena.teams.findIndex(t => t?.playerId === oldArena.createdBy);
    const topIndex = myIndex > -1 ? (myIndex + oldArena.teams.length/2) % oldArena.teams.length : creatorIndex;
    const indexMap = new Map([ [ 'top',0 ], [ 'btm',1 ] ]);
    const teamIndex = (topIndex + indexMap.get(slot)) % oldArena.teams.length;

    return oldArena.teams[teamIndex];
  })();
  const newTeam = arena && (() => {
    const myIndex = arena.teams.findIndex(t => t?.playerId === Tactics.authClient.playerId);
    const creatorIndex = arena.teams.findIndex(t => t?.playerId === arena.createdBy);
    const topIndex = myIndex > -1 ? (myIndex + arena.teams.length/2) % arena.teams.length : creatorIndex;
    const indexMap = new Map([ [ 'top',0 ], [ 'btm',1 ] ]);
    const teamIndex = (topIndex + indexMap.get(slot)) % arena.teams.length;

    const team = arena.teams[teamIndex];
    if (team?.joinedAt)
      team.isLoser = ![ undefined, teamIndex ].includes(arena.winnerId);
    else
      return null;
    return team;
  })();

  if (oldTeam && newTeam) {
    if (
      oldTeam.playerId === newTeam.playerId &&
      oldTeam.name === newTeam.name &&
      /*
      oldTeam.avatar === newTeam.avatar &&
      oldTeam.color === newTeam.color &&
      */
      imgUnit.classList.contains('loser') === newTeam.isLoser
    ) return false;
  }

  if (oldTeam) {
    await whenTransitionEnds(spnName, () => {
      spnName.classList.remove('show');
      imgUnit.classList.remove('show');
    });
  }

  if (newTeam) {
    const avatar = getAvatar(newTeam.playerId, { direction:slot === 'top' ? 'S' : 'N' });
    spnName.textContent = newTeam.name;
    imgUnit.classList.toggle('loser', newTeam.isLoser);
    imgUnit.style.top = `${avatar.y}px`;
    imgUnit.style.left = `${avatar.x}px`;
    imgUnit.src = avatar.src;

    await whenTransitionEnds(spnName, () => {
      spnName.classList.add('show');
      imgUnit.classList.add('show');
    });
  }
}
async function emptyArena(divArena, disabled = false) {
  if (divArena.classList.contains('empty')) {
    divArena.classList.toggle('disabled', disabled);
    return false;
  }

  const oldArena = arenaGameSummary.get(divArena);

  arenaGameSummary.delete(divArena);
  divArena.classList.remove('waiting');
  divArena.classList.remove('active');
  divArena.classList.remove('complete');
  divArena.classList.add('empty');

  divArena.querySelector('.labels').innerHTML = '';

  return Promise.all([
    fillTeam(divArena, 'top', null, oldArena),
    fillTeam(divArena, 'btm', null, oldArena),
  ]);
}
