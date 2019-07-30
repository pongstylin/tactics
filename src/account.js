import 'tactics/core.scss';
// Edge doesn't support the flat() function.
import 'plugins/array.js';
import clientFactory from 'client/clientFactory.js';
import popup from 'components/popup.js';
import copy from 'components/copy.js';

let authClient = clientFactory('auth');
let identityToken;
let devices;

window.addEventListener('DOMContentLoaded', () => {
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
        .then(renderPage)
        .catch(error => popup({
          message: 'There was an error while loading your account.',
          buttons: [],
          onCancel: () => false,
        }));
    else
      renderPage();
  });

  document.body.addEventListener('focus', event => {
    let target = event.target;
    if (target.matches('INPUT[type=text]'))
      target.select();
  }, true);
  document.body.addEventListener('blur', event => {
    let target = event.target;
    if (target.matches('INPUT[type=text]'))
      // Clear selection
      target.value = target.value;
  }, true);
  document.body.addEventListener('keydown', event => {
    let target = event.target;
    if (target.matches('INPUT[type=text]'))
      if (event.keyCode === 13)
        event.target.blur();
  }, true);
  document.body.addEventListener('input', event => {
    let target = event.target;
    if (target.matches('INPUT[type=text]')) {
      let inputTextAutosave = event.target.parentElement;
      inputTextAutosave.classList.remove('is-saved');
      inputTextAutosave.classList.remove('is-saving');
    }
  }, true);

  let divAccountAutoSave = document.querySelector('.accountName .inputTextAutosave');
  let divAccountError = divAccountAutoSave.nextElementSibling;
  let txtAccountName = divAccountAutoSave.querySelector('INPUT');
  txtAccountName.addEventListener('blur', event => {
    let newAccountName = txtAccountName.value.trim().length
      ? txtAccountName.value.trim() : null;

    if (newAccountName === null)
      newAccountName = authClient.playerName;

    // Just in case spaces were trimmed or the name unset.
    txtAccountName.value = newAccountName;

    divAccountError.textContent = '';

    if (newAccountName === authClient.playerName)
      divAccountAutoSave.classList.add('is-saved');
    else {
      divAccountAutoSave.classList.remove('is-saved');
      divAccountAutoSave.classList.add('is-saving');

      authClient.setAccountName(newAccountName)
        .then(() => {
          divAccountAutoSave.classList.remove('is-saving');
          divAccountAutoSave.classList.add('is-saved');
        })
        .catch(error => {
          divAccountAutoSave.classList.remove('is-saving');
          divAccountError.textContent = error.toString();
        });
    }
  });
});

function renderPage() {
  document.querySelector('INPUT[name=name]').value = authClient.playerName;

  Promise.all([
    authClient.getIdentityToken().then(data => {
      identityToken = data;
    }),
    authClient.getDevices().then(data => {
      devices = data;
    }),
  ]).then(() => {
    renderManageLink();
    renderDeviceList();

    document.querySelector('.page').style.display = '';
  });
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
    divDevices.append(divDevice);

    if (device.id === authClient.deviceId)
      divDevice.classList.add('current');

    let divHeader = document.createElement('DIV');
    divHeader.classList.add('header');
    divHeader.innerHTML = `
      <DIV class="inputTextAutosave is-saved">
        <INPUT
          type="text"
          name="deviceName"
          value="${deviceName}"
          placeholder="${autoDeviceName}"
          spellcheck="false"
        />
        <DIV class="icons">
          <SPAN class="fa fa-trash" title="Remove"></SPAN>
          <SPAN class="saved">
            <SPAN class="fa fa-spinner fa-pulse"></SPAN>
            <SPAN class="fa fa-check-circle"></SPAN>
          </SPAN>
        </DIV>
      </DIV>
      <DIV class="error"></DIV>
    `;
    divDevice.append(divHeader);

    let divDeviceAutoSave = divHeader.querySelector('.inputTextAutosave');
    let divDeviceError = divDeviceAutoSave.nextElementSibling;
    let txtDeviceName = divHeader.querySelector('INPUT');
    txtDeviceName.addEventListener('blur', event => {
      let newDeviceName = txtDeviceName.value.trim().length
        ? txtDeviceName.value.trim() : null;

      // Just in case spaces were trimmed
      txtDeviceName.value = newDeviceName;

      divDeviceError.textContent = '';

      if (newDeviceName === device.name)
        divDeviceAutoSave.classList.add('is-saved');
      else {
        divDeviceAutoSave.classList.remove('is-saved');
        divDeviceAutoSave.classList.add('is-saving');

        authClient.setDeviceName(device.id, newDeviceName)
          .then(() => {
            divDeviceAutoSave.classList.remove('is-saving');
            divDeviceAutoSave.classList.add('is-saved');

            device.name = newDeviceName;
          })
          .catch(error => {
            divDeviceAutoSave.classList.remove('is-saving');
            divDeviceError.textContent = error.toString();
          });
      }
    });

    divHeader.querySelector('.fa-trash').addEventListener('click', event => {
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
    });

    let divToggle = document.createElement('DIV');
    divToggle.classList.add('toggle');
    divToggle.setAttribute('title', 'Expand/Collapse');
    divToggle.innerHTML = `
      <SPAN class="fa fa-angle-double-down"></SPAN>
      <SPAN class="fa fa-angle-double-up"></SPAN>
      <SPAN class="label">Toggle device access details</SPAN>
    `;
    divDevice.append(divToggle);

    let divDetails = document.createElement('DIV');
    divDetails.classList.add('details');
    divDetails.style.height = '0';
    divDevice.append(divDetails);

    let divAgents = document.createElement('DIV');
    divAgents.classList.add('agents');
    agents.forEach(agent => {
      let divAgent = document.createElement('DIV');
      divAgent.classList.add('agent');
      divAgents.append(divAgent);

      let label = renderAgentName(agent);

      let divAgentLabel = document.createElement('DIV');
      divAgentLabel.classList.add('label');
      divAgentLabel.setAttribute('title', 'Expand/Collapse');
      divAgentLabel.innerHTML = label;
      divAgent.append(divAgentLabel);

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
        divAddresses.append(divAddress);
      });
      divAgent.append(divAddresses);
    });
    divDetails.append(divAgents);

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

