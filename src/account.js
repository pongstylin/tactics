import 'plugins/index.js';
import clientFactory from 'client/clientFactory.js';
import Autosave from 'components/Autosave.js';
import popup from 'components/popup.js';
import copy from 'components/copy.js';

const authClient = clientFactory('auth')
let accountNameAutosave;
let identityToken;
let devices;
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

  authClient.whenReady.then(() => {
    if (notice)
      notice.close();

    if (!authClient.playerId)
      authClient.register({ name:'Noob' })
        .then(renderPage)
        .catch(error => popup({
          message: 'There was an error while loading your account.',
          buttons: [],
          closeOnCancel: false,
        }));
    else
      renderPage();
  });
});

function renderPage() {
  accountNameAutosave.value = accountNameAutosave.defaultValue = authClient.playerName;

  Promise.all([
    authClient.getIdentityToken().then(data => {
      identityToken = data;
    }),
    authClient.getDevices().then(data => {
      devices = data;
    }),
    authClient.getACL().then(data => {
      acl = data;
      for (const playerACL of acl.values()) {
        delete playerACL.createdAt;
      }
    }),
  ]).then(() => {
    renderACL();
    renderManageLink();
    renderDeviceList();

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

function renderManageLink() {
  /*
   * See if an identity token is already associated with the account.
   */
  let manageLink = document.querySelector('.manageLink');

  if (identityToken) {
    let link = location.origin + '/addDevice.html?' + identityToken;
    let days = Math.floor((identityToken.expiresAt - new Date()) / 86400000);

    manageLink.innerHTML = `
      <DIV class="manage">
        <DIV>
          <BUTTON name="create">Refresh</BUTTON>
          <BUTTON name="revoke">Clear</BUTTON>
        </DIV>
        <DIV>
          Expires in ${days}d
          <SPAN class="fa fa-clock"></SPAN>
        </DIV>
      </DIV>
      <DIV class="link" title="Copy Link">
        <SPAN class="fa fa-copy"></SPAN>
        <SPAN class="label">${link}</SPAN>
      </DIV>
    `;

    document.querySelector('.link').addEventListener('click', event => {
      copy(link);
      popup('The link was copied');
    });
    document.querySelector('BUTTON[name=revoke]').addEventListener('click', event => {
      authClient.revokeIdentityToken().then(() => {
        identityToken = null;
        renderManageLink();
      });
    });
  }
  else {
    manageLink.innerHTML = `
      <DIV class="manage">
        <DIV>
          <BUTTON name="create">Create</BUTTON>
        </DIV>
      </DIV>
    `;
  }

  document.querySelector('BUTTON[name=create]').addEventListener('click', event => {
    authClient.createIdentityToken().then(token => {
      identityToken = token;
      renderManageLink();
    });
  });
}

function renderDeviceList() {
  let divDevices = document.querySelector('.devices');
  divDevices.innerHTML = '';

  /*
   * Sort devices according to the most recent date associated with an address.
   */
  devices.sort((a, b) => {
    let maxDateA = Math.max.apply(null,
      a.agents.map(agent =>
        agent.addresses.map(address => address.lastSeenAt)
      ).flat()
    );
    let maxDateB = Math.max.apply(null,
      b.agents.map(agent =>
        agent.addresses.map(address => address.lastSeenAt)
      ).flat()
    );

    return maxDateB - maxDateA; // ascending
  });

  devices.forEach(device => {
    let agents = device.agents;
    agents.sort((a, b) => {
      let maxDateA = Math.max.apply(null,
        a.addresses.map(address => address.lastSeenAt)
      );
      let maxDateB = Math.max.apply(null,
        b.addresses.map(address => address.lastSeenAt)
      );

      return maxDateB - maxDateA; // ascending
    });

    let deviceName = device.name === null ? '' : device.name;
    let autoDeviceName = renderDeviceName(
      agents.find(a => a.agent !== null) || agents[0]
    );

    let divDevice = document.createElement('DIV');
    divDevice.id = device.id;
    divDevice.classList.add('device');
    divDevices.appendChild(divDevice);

    if (device.id === authClient.deviceId)
      divDevice.classList.add('current');

    let divHeader = document.createElement('DIV');
    divHeader.classList.add('header');
    divDevice.appendChild(divHeader);

    const deviceNameAutosave = new Autosave({
      submitOnChange: true,
      name: 'deviceName',
      placeholder: autoDeviceName,
      value: deviceName,
      maxLength: 20,
      icons: new Map([
        [ 'remove', {
          name: 'trash',
          title: 'Remove',
          onClick: () => {
            let name = device.name === null ? autoDeviceName : device.name;
            name = name.replace(/ /g, '\xA0').replace(/-/g, '\u2011');

            popup({
              title: 'Remove Device',
              message: `Are you sure you want to remove '${name}'?`,
              buttons: [
                {
                  label: 'Yes',
                  onClick: () => authClient.removeDevice(device.id).then(() => {
                    divDevice.remove();
                  }),
                },
                { label: 'No' },
              ],
            });
          },
        }]
      ]),
    }).on('submit', event => event.waitUntil(async () => {
      await authClient.setDeviceName(device.id, event.data);
      device.name = event.data;
    }));
    deviceNameAutosave.appendTo(divHeader);

    let divToggle = document.createElement('DIV');
    divToggle.classList.add('toggle');
    divToggle.setAttribute('title', 'Expand/Collapse');
    divToggle.innerHTML = `
      <SPAN class="fa fa-angle-double-down"></SPAN>
      <SPAN class="fa fa-angle-double-up"></SPAN>
      <SPAN class="label">Toggle device access details</SPAN>
    `;
    divDevice.appendChild(divToggle);

    let divDetails = document.createElement('DIV');
    divDetails.classList.add('details');
    divDetails.style.height = '0';
    divDevice.appendChild(divDetails);

    let divAgents = document.createElement('DIV');
    divAgents.classList.add('agents');
    agents.forEach(agent => {
      let divAgent = document.createElement('DIV');
      divAgent.classList.add('agent');
      divAgents.appendChild(divAgent);

      let label = renderAgentName(agent);

      let divAgentLabel = document.createElement('DIV');
      divAgentLabel.classList.add('label');
      divAgentLabel.setAttribute('title', 'Expand/Collapse');
      divAgentLabel.innerHTML = label;
      divAgent.appendChild(divAgentLabel);

      divAgentLabel.addEventListener('click', event => {
        if (divAgentLabel.classList.toggle('full'))
          divAgentLabel.innerHTML = `
            <A href="javascript:void(0)">${agent.agent}</A>
          `;
        else
          divAgentLabel.innerHTML = `
            <A href="javascript:void(0)">${label}</A>
          `;
      });

      let addresses = agent.addresses;
      addresses.sort((a, b) => b.lastSeenAt - a.lastSeenAt);

      let divAddresses = document.createElement('DIV');
      divAddresses.classList.add('addresses');
      addresses.forEach(({address, lastSeenAt}) => {
        let elapsed = (new Date() - lastSeenAt) / 1000;
        if (elapsed < 60)
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

        let divAddress = document.createElement('DIV');
        divAddress.classList.add('address');
        divAddress.innerHTML = `
          <SPAN class="label">${address}</SPAN>
          <SPAN class="lastSeenAt">
            <SPAN class="short">
              <SPAN class="elapsed">${elapsed}</SPAN>
              <SPAN class="fa fa-clock"></SPAN>
            </SPAN>
            <SPAN class="long">${lastSeenAt.toLocaleString()}</SPAN>
          </SPAN>
        `;
        divAddresses.appendChild(divAddress);
      });
      divAgent.appendChild(divAddresses);
    });
    divDetails.appendChild(divAgents);

    divDetails.addEventListener('transitionend', event => {
      if (divDevice.classList.contains('expanded'))
        // Use 'auto' so that the height can resize dynamically.
        divDetails.style.height = 'auto';
    });

    divToggle.addEventListener('click', event => {
      if (divDevice.classList.toggle('expanded'))
        divDetails.style.height = divAgents.offsetHeight + 'px';
      else {
        // Change 'auto' to 'px' so that the transition will succeed.
        divDetails.style.height = divAgents.offsetHeight + 'px';
        setTimeout(() => { divDetails.style.height = '0'; });
      }
    });
  });
}

/*
 * The default device name is a shortened version of the user agent.
 */
function renderDeviceName(agent) {
  if (agent.agent === null)
    return 'Unavailable';

  let name;

  if (agent.device)
    name = agent.device.vendor + ' ' + agent.device.model;
  else if (agent.os) {
    name = agent.os.name;
    if (agent.os.version !== undefined)
      name += ' ' + agent.os.version;
  }

  if (agent.browser) {
    if (name)
      name += ' / ';

    name += agent.browser.name;
  }

  return name === undefined ? agent.agent : name;
}

/*
 * Same as the default device name, but includes browser version.
 */
function renderAgentName(agent) {
  if (agent.agent === null)
    return 'Unavailable';

  let name;

  if (agent.device)
    name = agent.device.vendor + ' ' + agent.device.model;
  else if (agent.os) {
    name = agent.os.name;
    if (agent.os.version !== undefined)
      name += ' ' + agent.os.version;
  }

  if (agent.browser) {
    if (name !== undefined)
      name += ' / ';

    name += agent.browser.name + ' ' + agent.browser.version;
  }

  return name === undefined ? agent.agent : name;
}

