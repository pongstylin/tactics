import * as arena from 'components/GameArena.js';

setInterval(() => {
  for (const spnClock of document.querySelectorAll('.clock'))
    spnClock.update();
}, 30000);

export function renderGame(game, { playerId = null, setId = null, rankingId = null } = {}) {
  const team1 = game.teams.find(t => setId ? t?.set?.id === setId : t?.playerId === (playerId ?? game.createdBy));
  const ranks1 = game.meta.ranks[team1.id];
  const team2 = game.teams.find(t => t !== team1);
  const ranks2 = team2 && game.meta.ranks[team2.id];

  rankingId ??= game.type;

  const divGame = document.createElement('DIV');
  divGame.id = game.id;
  divGame.dataset.type = game.type;
  divGame.classList.add('game');

  const divVS = document.createElement('DIV');
  divVS.classList.add('vs');

  const divArenaWrapper = document.createElement('DIV');
  divArenaWrapper.classList.add('arena-wrapper');

  const divArena = arena.renderArena(0);
  divArenaWrapper.append(divArena);
  arena.fillArena(divArena, game);

  divVS.append(divArenaWrapper);
  if (game.isChallenge && !team1.joinedAt)
    divVS.append(renderGameDecline(game));
  else
    divVS.append(renderGameTeam(game, team1, ranks1, rankingId, team1.playerId !== playerId));
  divVS.append(renderGameResult(game, team1.playerId));
  if (game.isSimulation && !game.startedAt)
    divVS.append(renderGameFinishSetup(game));
  else if (team2?.playerId)
    divVS.append(renderGameTeam(game, team2, ranks2, rankingId, team2.playerId !== playerId));
  else if (game.createdBy === Tactics.authClient.playerId)
    divVS.append(renderGameInvite(game))
  divGame.append(divVS);

  divGame.append(renderGameInfo(game));

  return divGame;
}
function renderGameTeam(game, team, ranks, rankingId, linkable = true) {
  const divTeam = document.createElement('DIV');
  divTeam.dataset.id = team.id;
  divTeam.classList.add('team');
  divTeam.classList.toggle('linkable', linkable && !!ranks);
  divTeam.dataset.playerId = team.playerId;

  const rank = ranks && (ranks.find(r => r.rankingId === rankingId) ?? null);
  const defaultRating = rankingId === 'FORTE' ? 0 : 750;
  const rating = [];

  if (game.rated) {
    const vsRatings = team.ratings.get(rankingId) ?? [ defaultRating, defaultRating ];
    const change = vsRatings[1] - vsRatings[0];
    const label = Math.abs(vsRatings[1] - vsRatings[0]) || '';

    rating.push(`<SPAN class="initial">${vsRatings[0]}</SPAN>`);
    rating.push(`<SPAN class="${label ? change > 0 ? 'up' : 'down' : ''}">${label}</SPAN> `);
  }

  if (ranks === null)
    rating.push(`<SPAN class="current">(Inactive)</SPAN>`);
  else if (ranks === false)
    rating.push(`<SPAN class="current">(Guest)</SPAN>`);
  else if (rank)
    rating.push(`<SPAN class="current">(${rank.rating})</SPAN>`);
  else
    rating.push(`<SPAN class="current">(${defaultRating})</SPAN>`);  

  divTeam.innerHTML = `
    <DIV class="name">${team.name}</DIV>
    <DIV class="set">${game.meta.setNames[team.id] ?? team.set.name ?? 'Set'}</DIV>
    <DIV class="rating">${rating.join('')}</DIV>
  `;

  return divTeam;
}
function renderGameDecline() {
  const divDecline = document.createElement('DIV');
  divDecline.classList.add('decline');
  divDecline.innerHTML = `<A href="javascript:void(0)">Decline Game</A>`;

  return divDecline;
}
function renderGameFinishSetup(game) {
  const divFinishSetup = document.createElement('DIV');
  divFinishSetup.innerHTML = `<A href="game.html?${game.id}">Finish Setup</A>`;

  return divFinishSetup;
}
function renderGameInvite(game) {
  const divInvite = document.createElement('DIV');
  divInvite.classList.add('invite');
  if (navigator.share) {
    divInvite.classList.add('share');
    divInvite.innerHTML = `<SPAN class="fa fa-share"></SPAN><SPAN class="label">Share Invite Link</SPAN>`;
  } else {
    divInvite.classList.add('copy');
    divInvite.innerHTML = `<SPAN class="fa fa-copy"></SPAN><SPAN class="label">Copy Invite Link</SPAN>`;
  }

  return divInvite;
}
function renderGameResult(game, playerId) {
  const divResult = document.createElement('DIV');
  divResult.classList.add('result');

  const spnResult = document.createElement('SPAN');
  divResult.append(spnResult);

  if (game.endedAt)
    spnResult.textContent = (
      game.winnerId === 'draw' ? 'Draw!' :
      game.winnerId === 'truce' ? 'Truce!' :
      game.winner?.playerId === playerId ? 'Win!' : 'Lose!'
    );
  else
    spnResult.textContent = 'VS';

  return divResult;
}
function renderGameInfo(game) {
  const divInfo = document.createElement('DIV');
  divInfo.classList.add('info');

  const labels = [];
  labels.push(game.typeName);
  if (!game.randomHitChance)
    labels.push('No Luck');
  if (game.timeLimitName && game.timeLimitName !== 'standard')
    labels.push(game.timeLimitName.toUpperCase('first'));

  if (game.isSimulation) {
    if (game.mode === 'fork')
      labels.push(game.mode.toUpperCase('first'));
  } else {
    if (game.mode)
      labels.push(game.mode.toUpperCase('first'));

    const isGuestGame = game.meta.ranks.some(r => r === false);

    if (!game.collection && game.mode !== 'fork')
      labels.push('Private');
    else if (!game.startedAt && game.rated === true)
      labels.push('Rated');
    else if (![ 'fork', 'practice' ].includes(game.mode) && game.rated === false && !isGuestGame)
      labels.push('Unrated');

    if (!game.startedAt && game.createdBy === Tactics.authClient.playerId) {
      const opponent = game.teams.find(t => t?.playerId !== game.createdBy);
      if (!opponent)
        labels.push('Anybody');
      else if (!opponent.playerId)
        labels.push('Share Link');
      else
        labels.push('Challenge');
    }
  }

  const spnLeft = document.createElement('SPAN');
  spnLeft.classList.add('left');
  spnLeft.textContent = labels.join(', ');
  divInfo.append(spnLeft);

  const spnRight = document.createElement('SPAN');
  spnRight.classList.add('right');
  if (game.startedAt)
    spnRight.append(renderDuration(game.currentTurnId));
  divInfo.append(spnRight);

  if (game.endedAt)
    spnRight.append(renderClock(game.endedAt, 'Ended At'));
  else if (game.startedAt && !game.isSimulation) {
    const isParticipant = game.teams.some(t => t.playerId === Tactics.authClient.playerId);
    if (isParticipant)
      spnRight.append(renderClock(spnClock => {
        const remaining = game.getTurnTimeRemaining();
        if (remaining < (game.currentTurnTimeLimit * 0.2))
          spnClock.classList.add('low');
        return remaining;
      }, 'Time Remaining'));
    else
      spnRight.append(renderClock(game.updatedAt, 'Updated At'));
  } else
    spnRight.append(renderClock(game.createdAt, 'Created At'));

  return divInfo;
}

export function renderDuration(numTurns) {
  const spnTurns = document.createElement('SPAN');
  spnTurns.classList.add('duration');
  spnTurns.title = 'Turn Count';

  spnTurns.innerHTML = `
    <SPAN class="numTurns">${numTurns}</SPAN>
    <SPAN class="fa fa-hourglass"></SPAN>
  `;

  return spnTurns;
}
// updator can be a Function or a Date
export function renderClock(updator, title = 'Since') {
  const spnClock = document.createElement('SPAN');
  spnClock.classList.add('clock');
  spnClock.title = title;
  spnClock.innerHTML = `
    <SPAN class="elapsed"></SPAN>
    <SPAN class="fa fa-clock"></SPAN>
  `;
  spnClock.update = function () {
    let elapsed = (updator instanceof Function ? updator(spnClock) : Tactics.gameClient.serverNow - updator) / 1000;
    if (elapsed <= 0)
      elapsed = '0';
    else if (elapsed < 60)
      elapsed = '<1m';
    else if (elapsed < 3600)
      elapsed = Math.floor(elapsed / 60) + 'm';
    else if (elapsed < 86400)
      elapsed = Math.floor(elapsed / 3600) + 'h';
    else if (elapsed < 604800)
      elapsed = Math.floor(elapsed / 86400) + 'd';
    else if (elapsed < 31557600)
      elapsed = Math.floor(elapsed / 604800) + 'w';
    else
      elapsed = Math.floor(elapsed / 31557600) + 'y';

    this.querySelector('.elapsed').textContent = elapsed;
    return this;
  };

  return spnClock.update();
}