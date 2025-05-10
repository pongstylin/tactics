import config from 'config/client.js';
import Autosave from 'components/Autosave.js';
import copy from 'components/copy.js';

const authClient = Tactics.authClient;
const popup = Tactics.popup;

let identityToken;
let devices;
let hasAuthProviderLinks;
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

  authClient.whenReady.then(async () => {
    if (notice)
      notice.close();

    await authClient.requireAuth();

    renderPage();
  });
});

function renderPage() {
  const promises = [
    authClient.getIdentityToken().then(data => {
      identityToken = data;
    }),
    authClient.getDevices().then(data => {
      devices = data;
    }),
  ];

  if (config.auth)
    promises.push(
      authClient.hasAuthProviderLinks().then(data => {
        hasAuthProviderLinks = data;
      }),
    );

  Promise.all(promises).then(() => {
    renderAccountAtRisk();
    renderAuthProviders();
    renderManageLink();
    renderDeviceList();

    document.querySelector('BUTTON[name=unlink]').addEventListener('click', async event => {
      await authClient.unlinkAuthProviders();
      for (const provider of hasAuthProviderLinks.keys()) {
        document.querySelector(`.${provider}`).classList.remove('linked');
        hasAuthProviderLinks.set(provider, false);
      }
      renderAccountAtRisk();
      renderManageLink();
    });

    document.querySelector('.page').style.display = '';
  });
}

function renderAccountAtRisk() {
  const isAccountAtRisk = !authClient.isVerified;

  document.body.classList.toggle('account-is-at-risk', isAccountAtRisk);
}
function renderAuthProviders() {
  if (!config.auth)
    return;

  const divAuth = document.querySelector('.auth');

  for (const provider of Object.keys(config.auth)) {
    const liProvider = document.querySelector(`.${provider}`);
    if (!config.auth[provider]) {
      liProvider.style.display = 'none';
      continue;
    }

    liProvider.classList.toggle('linked', hasAuthProviderLinks.get(provider));

    const btnLink = liProvider.querySelector('BUTTON');
    btnLink.addEventListener('click', () => {
      if (!liProvider.classList.contains('linked'))
        authClient.openAuthProvider(provider);
    });
  }

  divAuth.style.display = '';
}
function renderManageLink() {
  const subSection = document.querySelector('.security .link');
  const isAuthorized = config.auth && new Set([ ...hasAuthProviderLinks.values() ]).has(true);
  subSection.style.display = isAuthorized ? 'none' : '';
  document.querySelector('.security .unlink').style.display = isAuthorized ? '' : 'none';

  if (isAuthorized)
    return;

  subSection.style.display = '';

  /*
   * See if an identity token is already associated with the account.
   */
  const manageLink = subSection.querySelector('.manageLink');

  if (identityToken) {
    const link = location.origin + '/addDevice.html?' + identityToken;
    const days = Math.floor((identityToken.expiresAt - new Date()) / 86400000);

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

    subSection.querySelector('.link').addEventListener('click', event => {
      copy(link);
      popup('The link was copied');
    });
    subSection.querySelector('BUTTON[name=revoke]').addEventListener('click', event => {
      authClient.revokeIdentityToken().then(() => {
        identityToken = null;
        renderAccountAtRisk();
        renderManageLink();
      });
    });
  } else
    manageLink.innerHTML = `
      <DIV class="manage">
        <DIV>
          <BUTTON name="create">Create</BUTTON>
        </DIV>
      </DIV>
    `;

  subSection.querySelector('BUTTON[name=create]').addEventListener('click', event => {
    authClient.createIdentityToken().then(token => {
      identityToken = token;
      renderAccountAtRisk();
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
                    devices = devices.filter(d => d.id !== device.id);
                    renderAccountAtRisk();
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

