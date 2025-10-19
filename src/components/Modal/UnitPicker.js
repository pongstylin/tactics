import Modal from 'components/Modal.js';
import unitDataMap from 'tactics/unitData.js';

import 'components/Modal/UnitPicker.scss';

const template = `
  <DIV class="tabs">
    <UL>
      <LI data-tab="quick" class="selected"><span class="label">Quick Picks</span></LI>
      <LI data-tab="details"><span class="label">Unit Details</span></LI>
      <LI data-tab="rules"><span class="label">Style Rules</span></LI>
    </UL>
  </DIV>
  <DIV class="tabContent">
    <DIV class="quick show">
      <DIV class="info"></DIV>
      <DIV class="units"></DIV>
    </DIV>
    <DIV class="details">
      <DIV class="info"></DIV>
      <DIV class="units"></DIV>
    </DIV>
    <DIV class="rules"></DIV>
  </DIV>
`;

export default class UnitPicker extends Modal {
  constructor(data, options = {}) {
    options.title = 'Choose a Unit';
    options.content = template;
    options.autoShow = false;
    options.hideOnCancel = true;

    super(options, data);

    Object.assign(this, {
      currentTab: 'quick',
      whenPicked: null,
    });

    Object.assign(this._els, {
      tabs: this._els.content.querySelector('.tabs'),
      quick: this._els.content.querySelector('.quick'),
      quickInfo: this._els.content.querySelector('.quick .info'),
      quickUnits: this._els.content.querySelector('.quick .units'),
      details: this._els.content.querySelector('.details'),
      detailsInfo: this._els.content.querySelector('.details .info'),
      detailsUnits: this._els.content.querySelector('.details .units'),
      rules: this._els.content.querySelector('.rules'),
    });

    this.root.classList.add('unitPicker');

    this._els.content.addEventListener('click', event => {
      const divUnit = event.target.closest('.unit.available');
      if (divUnit) {
        this.onUnitPick(divUnit.dataset.unitType);
        return;
      }

      const divTab = event.target.closest('.tabs LI');
      if (divTab && divTab.dataset.tab !== this.currentTab) {
        this._els.tabs.querySelector('.selected').classList.remove('selected');
        this._els[this.currentTab].classList.remove('show');
        this.currentTab = divTab.dataset.tab;
        this._els.tabs.querySelector(`[data-tab="${this.currentTab}"]`).classList.add('selected');
        this._els[this.currentTab].classList.add('show');

        if (this.currentTab === 'quick')

        return;
      }
    });

    this._els.rules.textContent = this.data.gameType.description;
  }

  get team() {
    return this.data.team;
  }
  set team(team) {
    this.data.team = team;
  }

  /*****************************************************************************
   * Public Methods
   ****************************************************************************/
  canPick() {
    return this.getStats().available > 0;
  }

  getStats() {
    const gameType = this.data.gameType;
    if (!gameType.isCustomizable)
      return { available:0 };

    const units = this.data.team.units;
    const unitCounts = new Map();
    const stats = {
      points: {
        total: gameType.getPoints(),
        used: 0,
      },
      units: [],
      available: 0,
    };

    for (const unit of units) {
      if (unit.disposition === 'dead') continue;

      if (unitCounts.has(unit.type))
        unitCounts.set(unit.type, unitCounts.get(unit.type) + 1);
      else
        unitCounts.set(unit.type, 1);

      stats.points.used += gameType.getUnitPoints(unit.type);
    }

    stats.points.remaining = stats.points.total - stats.points.used;

    for (const unitType of gameType.getUnitTypes()) {
      const unitData = unitDataMap.get(unitType);
      const unitStats = {
        name: unitData.name,
        type: unitType,
        points: gameType.getUnitPoints(unitType),
        max: gameType.getUnitMaxCount(unitType),
        count: unitCounts.get(unitType) ?? 0,
      };
      unitStats.available = Math.min(
        unitStats.max - unitStats.count,
        Math.floor(stats.points.remaining / unitStats.points),
      );

      stats.units.push(unitStats);
    }

    if (stats.points.remaining) {
      let remaining = stats.points.remaining;
      stats.units.sort((a,b) => b.available - a.available || a.points - b.points);

      for (const unitStats of stats.units) {
        const available = Math.min(
          unitStats.max - unitStats.count,
          Math.floor(remaining / unitStats.points),
        );
        if (available === 0)
          break;

        stats.available += available;
        remaining -= available * unitStats.points;
      }
    }

    return stats;
  }

  pick() {
    this._renderUnits();

    this.show();

    return this.whenPicked = new Promise();
  }

  onUnitPick(unitType) {
    this.whenPicked.resolve(unitType);
    this.hide();
  }

  /*****************************************************************************
   * Private Methods
   ****************************************************************************/
  _renderUnits() {
    const stats = this.getStats();
    stats.units.sort((a,b) => !!b.available - !!a.available || a.name.localeCompare(b.name));

    if (stats.available === 1)
      this._els.quickInfo.textContent = `You may place one more unit.`;
    else
      this._els.quickInfo.textContent = `You may place up to ${stats.available} more units.`;

    if (stats.points.remaining === 1)
      this._els.detailsInfo.textContent = `You have one point remaining.`;
    else
      this._els.detailsInfo.textContent = `You have ${stats.points.remaining} points remaining.`;

    this._els.quickUnits.innerHTML = '';
    this._els.detailsUnits.innerHTML = '';

    for (const unitStats of stats.units) {
      if (unitStats.available)
        this._els.quickUnits.appendChild(this._renderUnit(stats, unitStats));

      this._els.detailsUnits.appendChild(this._renderUnit(stats, unitStats, true));
    }
  }

  _renderUnit(stats, unitStats, withDetails = false) {
    const divUnit = document.createElement('DIV');
    divUnit.classList.add('unit');
    divUnit.classList.toggle('available', unitStats.available > 0);
    if (unitStats.available)
      divUnit.tabIndex = 0;
    divUnit.dataset.unitType = unitStats.type;

    const divImage = document.createElement('DIV');
    divImage.classList.add('image');
    divUnit.appendChild(divImage);

    const avatar = { unitType:unitStats.type, colorId:this.data.team.colorId };
    const imgUnit = Tactics.getAvatarImage(avatar, { withFocus:unitStats.available > 0 });
    imgUnit.title = 'Select Unit';
    divImage.appendChild(imgUnit);

    const lblUnit = document.createElement('LABEL');
    lblUnit.textContent = unitDataMap.get(unitStats.type).name;
    divImage.appendChild(lblUnit);

    if (withDetails) {
      const divDetails = document.createElement('DIV');
      divDetails.classList.add('details');
      divUnit.appendChild(divDetails);

      divDetails.innerHTML = `
        <DIV class="available">
          <DIV>Available:</DIV>
          <DIV>${unitStats.available}</DIV>
        </DIV>
        <DIV class="maximum">
          <DIV>Maximum:</DIV>
          <DIV>${unitStats.max}</DIV>
        </DIV>
        <DIV class="points">
          <DIV>Points:</DIV>
          <DIV>${unitStats.points}</DIV>
        </DIV>
      `;

      divDetails.querySelector('.maximum').classList.toggle('alert', unitStats.count === unitStats.max);
      divDetails.querySelector('.points').classList.toggle('alert', unitStats.points > stats.points.remaining);
    }

    return divUnit;
  }
};
