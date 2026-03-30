import Autosave from 'components/Autosave.js';

const authClient = Tactics.authClient;
const popup = Tactics.popup;

let accountNameAutosave;
let acl;
let relationships;
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
    }),
    authClient.getActiveRelationships().then(data => {
      relationships = data;
      for (const relationship of relationships.values()) {
        delete relationship.createdAt;
      }
    }),
  ];

  Promise.all(promises).then(() => {
    renderACL();
    renderApplication();

    document.querySelector('.page').style.display = '';
  });
}

function renderACL() {
  const ruleTypes = [ 'newAccounts', 'guestAccounts' ];
  const aclTypes = [ 'muted', 'blocked' ];
  const relationshipTypes = [ 'friended', 'muted', 'blocked' ];
  const sortedACL = [ ...relationships ].sort((a,b) =>
    relationshipTypes.indexOf(a[1].type) - relationshipTypes.indexOf(b[1].type) ||
    a[1].name.localeCompare(b[1].name)
  );

  const divACL = document.querySelector('.acl');
  const activateACL = newACL => {
    acl = newACL;
    for (const ruleType of ruleTypes)
      for (const aclType of aclTypes)
        divACL.querySelector(`.rule[data-rule=${ruleType}] .${aclType}`).classList.toggle('active', acl[ruleType] === aclType);
  };
  activateACL(acl);
  divACL.addEventListener('click', event => {
    const spnButton = event.target.closest('.muted, .blocked');
    if (!spnButton)
      return;

    const divRule = spnButton.closest('.rule');
    const newACL = { ...acl };

    if (spnButton.classList.contains('active'))
      newACL[divRule.dataset.rule] = null;
    else
      newACL[divRule.dataset.rule] = spnButton.dataset.value;
    authClient.setACL({
      newAccounts: newACL.newAccounts,
      guestAccounts: newACL.guestAccounts,
    }).then(() => activateACL(newACL));
  });

  const divRelationships = document.querySelector('.relationships');

  for (const [ playerId, relationship ] of sortedACL) {
    const divPlayer = document.createElement('DIV');
    divPlayer.id = `relationship-${playerId}`;
    divPlayer.classList.add('relationship');
    divRelationships.appendChild(divPlayer);

    const divName = document.createElement('DIV');
    divName.classList.add('name');
    divPlayer.appendChild(divName);

    const autosave = new Autosave({
      submitOnChange: true,
      defaultValue: false,
      value: relationship.name,
      maxLength: 20,
      icons: new Map([
        [ 'friended', {
          name: 'user-friends',
          title: 'Friend',
          active: relationship.type === 'friended',
          onClick: async friendIcon => {
            if (friendIcon.active) {
              await authClient.clearRelationship(playerId);
              friendIcon.active = false;
            } else {
              relationship.type = 'friended';
              await authClient.setRelationship(playerId, relationship);
              friendIcon.active = true;
              autosave.icons.get('muted').active = false;
              autosave.icons.get('blocked').active = false;
            }
          },
        }],
        [ 'muted', {
          name: 'microphone-slash',
          title: 'Mute',
          active: relationship.type === 'muted',
          onClick: async muteIcon => {
            if (muteIcon.active) {
              await authClient.clearRelationship(playerId);
              muteIcon.active = false;
            } else {
              popup({
                title: `Mute <I>${relationship.name}</I>?`,
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
                      relationship.type = 'muted';
                      await authClient.setRelationship(playerId, relationship);
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
          active: relationship.type === 'blocked',
          onClick: async blockIcon => {
            if (blockIcon.active) {
              await authClient.clearRelationship(playerId);
              blockIcon.active = false;
            } else {
              popup({
                title: `Block <I>${relationship.name}</I>?`,
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
                      relationship.type = 'blocked';
                      await authClient.setRelationship(playerId, relationship);
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
      relationship.name = event.data;
      return authClient.setRelationship(playerId, relationship);
    }));
    autosave.appendTo(divName);
  }
}

async function renderApplication() {
  const divClientVersion = document.querySelector('.client-version .value');
  const divServerVersion = document.querySelector('.server-version .value');
  const divWebGLEngine = document.querySelector('.webgl-engine .value');
  const divWebGPUEngine = document.querySelector('.webgpu-engine .value');
  const isWebGLAvailable = PIXI.isWebGLSupported();
  const isWebGPUAvailable = await PIXI.isWebGPUSupported();
  const isWebGLCompromised = isWebGLAvailable && !PIXI.isWebGLSupported(true);
  const rendererType = await (async () => {
    try {
      const renderer = await Tactics.makeAvatarRenderer();
      return renderer.type === 1 ? 'WebGL' : renderer.type === 2 ? 'WebGPU' : 'Canvas';
    } catch {
      return 'Unavailable';
    }
  })();
  const isWebGLActive = rendererType === 'WebGL';
  const isWebGPUActive = rendererType === 'WebGPU';

  divClientVersion.textContent = Tactics.version;
  divServerVersion.textContent = authClient._server.version;

  divWebGLEngine.innerHTML = [
    isWebGLActive ? 'Active' : isWebGLAvailable ? 'Available' : 'Unavailable',
    isWebGLCompromised ? ' <span style="color:orange;">(Compromised)</span>' : '',
    isWebGLAvailable && !isWebGLActive ? ' <button name="WebGL">Select</button>' : '',
  ].join('');
  divWebGPUEngine.innerHTML = [
    isWebGPUActive ? 'Active' : isWebGPUAvailable ? 'Available' : 'Unavailable',
    isWebGPUAvailable && !isWebGPUActive ? ' <button name="WebGPU">Select</button>' : '',
  ].join('');

  document.querySelector('button[name="WebGL"], button[name="WebGPU"]')?.addEventListener('click', async (event) => {
    const rendererType = event.target.getAttribute('name');
    popup({
      message: `Switching to the ${rendererType} rendering engine requires reloading the page. Continue?`,
      buttons: [
        {
          label: 'Reload',
          onClick: () => {
            localStorage.setItem('preferredRenderer', rendererType.toLowerCase());
            location.reload();
          },
        },
        { label: 'Cancel' },
      ],
    });
  });
}