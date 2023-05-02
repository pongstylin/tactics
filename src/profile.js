import Autosave from 'components/Autosave.js';

const authClient = Tactics.authClient;
const popup = Tactics.popup;

let accountNameAutosave;
let acl;
window.addEventListener('DOMContentLoaded', () => {
  let notice;
  if (navigator.onLine === false)
    notice = popup({
      message: 'The page will load once you are online.',
      buttons: [],
      closeOnCancel: false,
    });
  else if (!authClient.isOnline)
    notice = popup({
      message: 'Connecting to server...',
      buttons: [],
      closeOnCancel: false,
      autoOpen: 1000, // open after one second
    });

  accountNameAutosave = new Autosave({
    submitOnChange: true,
    defaultValue: false,
    maxLength: 20,
  }).on('submit', event => event.waitUntil(
    authClient.setAccountName(event.data),
  ));
  accountNameAutosave.attach(
    document.querySelector('.accountName .inputTextAutosave'),
  );

  authClient.whenReady.then(async () => {
    if (notice)
      notice.close();

    await authClient.requireAuth();

    renderPage();
  });
});

function renderPage() {
  accountNameAutosave.value = accountNameAutosave.defaultValue = authClient.playerName;

  const promises = [
    authClient.getACL().then(data => {
      acl = data;
      for (const playerACL of acl.values()) {
        delete playerACL.createdAt;
      }
    }),
  ];

  Promise.all(promises).then(() => {
    renderACL();

    document.querySelector('.page').style.display = '';
  });
}

function renderACL() {
  const content = [];
  const aclTypes = [ 'muted', 'blocked' ];
  const sortedACL = [ ...acl ].sort((a,b) =>
    aclTypes.indexOf(a[1].type) - aclTypes.indexOf(b[1].type) ||
    a[1].name.localeCompare(b[1].name)
  );
  const divACL = document.querySelector('.acl');

  for (const [ playerId, playerACL ] of acl) {
    const divPlayer = document.createElement('DIV');
    divPlayer.id = `playerACL-${playerId}`;
    divPlayer.classList.add('playerACL');
    divACL.appendChild(divPlayer);

    const divName = document.createElement('DIV');
    divName.classList.add('name');
    divPlayer.appendChild(divName);

    const autosave = new Autosave({
      submitOnChange: true,
      defaultValue: false,
      value: playerACL.name,
      maxLength: 20,
      icons: new Map([
        [ 'friended', {
          name: 'user-friends',
          title: 'Friend',
          active: playerACL.type === 'friended',
          onClick: async friendIcon => {
            if (friendIcon.active) {
              await authClient.clearPlayerACL(playerId);
              friendIcon.active = false;
            } else {
              playerACL.type = 'friended';
              await authClient.setPlayerACL(playerId, playerACL);
              friendIcon.active = true;
              autosave.icons.get('muted').active = false;
              autosave.icons.get('blocked').active = false;
            }
          },
        }],
        [ 'muted', {
          name: 'microphone-slash',
          title: 'Mute',
          active: playerACL.type === 'muted',
          onClick: async muteIcon => {
            if (muteIcon.active) {
              await authClient.clearPlayerACL(playerId);
              muteIcon.active = false;
            } else {
              popup({
                title: `Mute <I>${playerACL.name}</I>?`,
                message: [
                  `<DIV>If you mute this player, you will:</DIV>`,
                  `<UL>`,
                    `<LI>Disable chat in all games against them.</LI>`,
                    `<LI>Hide chat in all games against them.</LI>`,
                  `</UL>`,
                  `<DIV>You can see a list of all muted players on your account page.</DIV>`,
                ].join('  '),
                buttons: [
                  {
                    label: 'Mute',
                    onClick: async () => {
                      playerACL.type = 'muted';
                      await authClient.setPlayerACL(playerId, playerACL);
                      muteIcon.active = true;
                      autosave.icons.get('friended').active = false;
                      autosave.icons.get('blocked').active = false;
                    }
                  },
                  { label:'Cancel' },
                ],
              });
            }
          },
        }],
        [ 'blocked', {
          name: 'ban',
          title: 'Block',
          active: playerACL.type === 'blocked',
          onClick: async blockIcon => {
            if (blockIcon.active) {
              await authClient.clearPlayerACL(playerId);
              blockIcon.active = true;
            } else {
              popup({
                title: `Block <I>${playerACL.name}</I>?`,
                message: [
                  `<DIV>If you block this player, you will:</DIV>`,
                  `<UL>`,
                    `<LI>Disable chat in all games against them.</LI>`,
                    `<LI>Hide chat in all games against them.</LI>`,
                    `<LI>Surrender all active games against them.</LI>`,
                    `<LI>Avoid getting auto matched with them in public games.</LI>`,
                    `<LI>Prevent them from seeing your waiting games.</LI>`,
                    `<LI>Prevent them from joining your shared game links.</LI>`,
                  `</UL>`,
                  `<DIV>You can see a list of all blocked players on your account page.</DIV>`,
                ].join(''),
                buttons: [
                  {
                    label: 'Block',
                    onClick: async () => {
                      playerACL.type = 'blocked';
                      await authClient.setPlayerACL(playerId, playerACL);
                      blockIcon.active = true;
                      autosave.icons.get('friended').active = false;
                      autosave.icons.get('muted').active = false;
                    }
                  },
                  { label:'Cancel' },
                ],
              });
            }
          },
        }],
      ]),
    }).on('submit', event => event.waitUntil(() => {
      playerACL.name = event.data;
      return authClient.setPlayerACL(playerId, playerACL);
    }));
    autosave.appendTo(divName);
  }
}
