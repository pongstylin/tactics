import popup from 'components/popup.js';

const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;
const SetSetup = Tactics.SetSetup;

let setSetup;
let team = {
  colorId: 'Red',
  set: [
    // Back Row
    {assignment:[5, 0], type:'Cleric'},
    // Middle Row
    {assignment:[2, 1], type:'DarkMagicWitch'},
    {assignment:[3, 1], type:'Pyromancer'},
    {assignment:[7, 1], type:'Pyromancer'},
    {assignment:[8, 1], type:'Enchantress'},
    // Front Row
    {assignment:[1, 2], type:'Assassin'},
    {assignment:[4, 2], type:'Knight'},
    {assignment:[5, 2], type:'Knight'},
    {assignment:[6, 2], type:'Knight'},
    {assignment:[9, 2], type:'Scout'},
  ]
};

var buttons = {
  rotate: function ($button) {
    let classesToToggle;

    if ($button.hasClass('fa-rotate-90'))
      classesToToggle = 'fa-rotate-90 fa-rotate-180';
    else if ($button.hasClass('fa-rotate-180'))
      classesToToggle = 'fa-rotate-180 fa-rotate-270';
    else if ($button.hasClass('fa-rotate-270'))
      classesToToggle = 'fa-rotate-270';
    else
      classesToToggle = 'fa-rotate-90';

    $button.toggleClass(classesToToggle);
    setSetup.rotateBoard(90);
  },
  sound: function ($button) {
    $button.toggleClass('fa-bell fa-bell-slash');

    Howler.mute($button.hasClass('fa-bell-slash'));
  },
};

window.addEventListener('resize', () => {
  if (setSetup) setSetup.resize();
});

window.addEventListener('DOMContentLoaded', async () => {
  let notice;
  if (navigator.onLine === false)
    notice = popup({
      message: 'The page will load once you are online.',
      buttons: [],
      onCancel: () => false,
    });
  else if (!authClient.isOnline)
    notice = popup({
      message: 'Connecting to server...',
      buttons: [],
      onCancel: () => false,
      open: 1000, // open after one second
    });

  authClient.whenReady.then(() => {
    if (notice)
      notice.close();

    if (!authClient.playerId)
      authClient.register({ name:'Noob' })
        .then(load)
        .catch(error => popup({
          message: 'There was an error while loading your account.',
          buttons: [],
          onCancel: () => false,
        }));
    else
      load();
  });
});

async function load() {
  $('#loader').css({
    top:($(window).height()/2)-($('#loader').height()/2)+'px',
    left:($(window).width()/2)-($('#loader').width()/2)+'px',
    visibility:'visible'
  });

  if (Howler.noAudio)
    $('BUTTON[name=sound]').toggleClass('hidden');

  $('BODY')
    .on('mouseover','#app BUTTON:enabled', event => {
      var $button = $(event.target);

      // Ignore disabled buttons
      if (window.getComputedStyle(event.target).cursor !== 'pointer')
        return;

      Tactics.sounds.focus.play();
    })
    .on('click','#app BUTTON:enabled', event => {
      var $button = $(event.target);
      var handler = $button.data('handler') || buttons[$button.attr('name')];

      // Ignore disabled buttons
      if (window.getComputedStyle(event.target).cursor !== 'pointer')
        return;

      handler($button);

      Tactics.sounds.select.play();
    });

  $('#splash').show();

  let gameType = new URL(location.href).searchParams.get('type');
  let gameTypeConfig = await gameClient.getGameTypeConfig(gameType);
  let unitTypes = gameTypeConfig.limits.units.types.keys();

  Tactics.load(unitTypes, percent => {
    $('#progress').width(percent);
  }).then(() => {
    setSetup = new SetSetup(team);

    $(setSetup.canvas)
      .attr('id', 'board')
      .appendTo('#field');

    setSetup.resize();

    $('#splash').hide();
    $('#setup').css({ position:'', visibility:'' });
  });
}
