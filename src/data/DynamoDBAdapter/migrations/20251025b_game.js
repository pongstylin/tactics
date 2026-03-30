const unitDataMap = new Map();

export default async function (itemMap) {
  const item = itemMap.get('/');
  const turnsItem = itemMap.get('/turns/') ?? (await Promise.all((await this._queryItemParts({ PK:item.PK, SK:'/turns/' })).map(ti => {
    ti.id = parseInt(ti.SK.split('/')[2], 10);
    return this._parseItem(ti);
  }))).sort((a, b) => a.id - b.id);
  // The 2nd condition only happens when game data is missing.
  if (turnsItem.length === 0 || turnsItem.last.id > turnsItem.length - 1)
    return item;

  const turnsItemWithDirty = turnsItem.map(ti => Object.assign({ isDirty:false }, ti));

  for (const turnItem of turnsItemWithDirty) {
    const units = turnItem.D.$data.units.flat();
    for (const action of turnItem.D.$data.actions) {
      if (!action.results) continue;

      const results = action.results.slice();
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.changes) {
          const unitData = units.find(u => u.id === result.unit);
          if (unitData && unitData.type === 'Shrub' && result.changes.mHealth === -1) {
            result.changes.disposition = 'dead';
            delete result.changes.mHealth;
            turnItem.isDirty = true;
          }
        }

        if (result.results)
          results.push(...result.results);
      }
    }
  }

  itemMap.set('/turns/', turnsItemWithDirty);
};

unitDataMap.set('Knight', {
  name: 'Knight',
  ability: 'Sword & Shield',
  power: 22,
  armor: 25,
  health: 50,
  recovery: 1,
  blocking: 80,
  mType: 'path',
  mRadius: 3,
  aType: 'melee',
  aRange: [1, 1],
  tier: 1,
});

unitDataMap.set('Pyromancer', {
  name: 'Pyromancer',
  ability: 'Fire',
  power: 15,
  armor: 0,
  health: 30,
  recovery: 3,
  blocking: 33,
  mType: 'path',
  mRadius: 3,
  aType: 'magic',
  aRange: [0, 3],
  waitFirstTurn: true,
  tier: 1,
});

unitDataMap.set('Scout', {
  name: 'Scout',
  ability: 'Long Shot',
  power: 18,
  armor: 8,
  health: 40,
  recovery: 2,
  blocking: 60,
  mType: 'path',
  mRadius: 4,
  aType: 'melee',
  aRange: [1, 6],
  aLOS: true,
  waitFirstTurn: true,
  tier: 1,
});

unitDataMap.set('Cleric', {
  name: 'Cleric',
  ability: 'Holy Mass',
  power: 12,
  armor: 0,
  health: 24,
  recovery: 5,
  blocking: 0,
  mType: 'path',
  mRadius: 3,
  aType: 'heal',
  aAll: true,
  tier: 1,
});

unitDataMap.set('BarrierWard', {
  name: 'Barrier Ward',
  ability: 'Barrier',
  power: 0,
  armor: 0,
  health: 32,
  recovery: 2,
  blocking: 100,
  mType: false,
  mRadius: 0,
  mPass: false,
  aType: 'barrier',
  aFocus: true,
  aRange: [0, 6],
  directional: false,
  tier: 5,
});

unitDataMap.set('LightningWard', {
  name: 'Lightning Ward',
  ability: 'Lightning',
  power: 30,
  armor: 18,
  health: 56,
  recovery: 4,
  blocking: 100,
  mType: false,
  mRadius: 0,
  mPass: false,
  aType: 'magic',
  aRange: [0, 3],
  directional: false,
  tier: 5,
});

unitDataMap.set('DarkMagicWitch', {
  name: 'Dark Magic Witch',
  ability: 'Black Spikes',
  power: 24,
  armor: 0,
  health: 28,
  recovery: 3,
  blocking: 20,
  mType: 'path',
  mRadius: 3,
  aType: 'magic',
  aRange: [1, 4],
  aLinear: true,
  waitFirstTurn: true,
  tier: 1,
});

unitDataMap.set('Assassin', {
  name: 'Assassin',
  ability: 'Multi-Strike',
  specialty: 'Deathblow',
  power: 18,
  armor: 12,
  health: 35,
  recovery: 1,
  blocking: 70,
  mType: 'path',
  mRadius: 4,
  aType: 'melee',
  aRange: [1, 1],
  aAll: true,
  tier: 1,
});

unitDataMap.set('Enchantress', {
  name: 'Enchantress',
  ability: 'Paralytic Field',
  power: 0,
  armor: 0,
  health: 35,
  recovery: 3,
  blocking: 0,
  mType: 'path',
  mRadius: 3,
  aType: 'paralyze',
  aFocus: true,
  aRange: [1, 2],
  aAll: true,
  tier: 1,
});

unitDataMap.set('MudGolem', {
  name: 'Mud Golem',
  ability: 'Punch',
  specialty: 'Quake',
  power: 20,
  armor: 0,
  health: 60,
  recovery: 2,
  blocking: 0,
  mType: 'teleport',
  mRadius: 5,
  aType: 'melee',
  aRange: [1, 1],
  waitFirstTurn: true,
  tier: 2,
});

unitDataMap.set('FrostGolem', {
  name: 'Frost Golem',
  ability: 'Paralyze',
  power: 0,
  armor: 0,
  health: 60,
  recovery: 2,
  blocking: 0,
  mType: 'path',
  mRadius: 2,
  aType: 'paralyze',
  aFocus: true,
  aRange: [1, 4],
  tier: 2,
});

unitDataMap.set('StoneGolem', {
  name: 'Stone Golem',
  ability: 'Shell',
  power: 0,
  armor: 30,
  health: 60,
  recovery: 4,
  blocking: 0,
  mType: 'path',
  mRadius: 2,
  aType: 'armor',
  aFocus: true,
  aRange: [0, 1],
  tier: 4,
});

unitDataMap.set('DragonTyrant', {
  name: 'Dragon Tyrant',
  ability: 'Fire Blast',
  power: 28,
  armor: 16,
  health: 68,
  recovery: 3,
  blocking: 40,
  mType: 'teleport',
  mRadius: 4,
  mPass: false,
  aType: 'magic',
  aRange: [1, 3],
  aLOS: true,
  aLinear: true,
  waitFirstTurn: true,
  tier: 3,
});

unitDataMap.set('BeastRider', {
  name: 'Beast Rider',
  ability: 'Piercing Thrust',
  power: 19,
  armor: 15,
  health: 38,
  recovery: 1,
  blocking: 45,
  mType: 'path',
  mRadius: 4,
  mPass: false,
  aType: 'melee',
  aRange: [1, 2],
  aLinear: true,
  tier: 2,
});

unitDataMap.set('DragonspeakerMage', {
  name:'Dragonspeaker Mage',
  ability: 'Dragon Fire',
  power: 15,
  armor: 0,
  health: 30,
  recovery: 3,
  blocking: 33,
  mType: 'path',
  mRadius: 3,
  aType: 'magic',
  aRange: [0, 3],
  waitFirstTurn: true,
  tier: 4,
});

unitDataMap.set('ChaosSeed', {
  name: 'Chaos Seed',
  ability: 'Chaos',
  specialty: 'Awaken',
  power: 24,
  armor: 95,
  health: 6,
  recovery: 0,
  blocking: 50,
  mType: false,
  mRadius: 0,
  aType: 'magic',
  directional: false,

  baseSprite: 'WyvernEgg',
  imports: ['Lightning','Sparkle'],
  sounds: {
    crack: 'crack',
    attack: 'sprite:core/sounds/sound1370',
    block: 'sprite:core/sounds/sound8',
    heal: 'sprite:core/sounds/sound1203',
    wind: {
      src: 'chaos',
      volume: 0.5,
      sprite: {
        wind1: [   0, 1950],
        wind2: [2150, 1950],
        wind3: [4300, 1800],
        wind4: [6300, 2500],
        wind5: [9000, 1725]
      }
    },
    phase: {
      src: 'sprite:core/sounds/sound4',
      rate: 0.5,
    },
    roar: {
      src: 'chaos',
      sprite: {
        roar: [10925, 1675],
      }
    }
  },
  tier: 5,
});

unitDataMap.set('PoisonWisp', {
  name: 'Poison Wisp',
  ability: 'Poison',
  power: 4,
  armor: 0,
  health: 30,
  recovery: 2,
  blocking: 0,
  mType: 'teleport',
  mRadius: 6,
  aType: 'poison',
  aRange: [1, 2],
  aAll: true,
  aLinear: true,
  waitFirstTurn: true,
  tier: 3,
});

unitDataMap.set('Furgon', {
  name: 'Furgon',
  ability: 'Summon Nature',
  specialty: 'Entangle',
  power: 0,
  armor: 0,
  health: 48,
  recovery: 1,
  blocking: 50,
  mType: 'path',
  mRadius: 3,
  aType: 'summon',
  aRange: [0, 2],
  tier: 2,
  features: {
    // Turn this off to enable limited lifetimes for shrubs.
    evergreen: false,
    // Turn this on to enable transform-on-death
    transform: true,
  },
});

unitDataMap.set('Shrub', {
  name: 'Shrub',
  power: 0,
  armor: 0,
  health: 1,
  lifespan: 3,
  recovery: 0,
  blocking: 0,
  mType: false,
  mPass: false,
  aType: false,
  directional: false,
  tier: 5,
  sounds: {
    block: 'sprite:core/sounds/sound8',
  },
});

unitDataMap.set('Trophy', {
  name: 'Trophy',
  tier: 5,
  sounds: {
    block: 'sprite:core/sounds/sound8',
  },
});

unitDataMap.set('GolemAmbusher', {
  name: 'Golem Ambusher',
  ability: 'Boulder',
  power: 20,
  armor: 0,
  health: 60,
  recovery: 2,
  blocking: 0,
  mType: 'path',
  mRadius: 3,
  aType: 'melee',
  aRange: [3, 4],
  waitFirstTurn: true,
  tier: 3,
});

unitDataMap.set('Berserker', {
  name: 'Berserker',
  ability: 'Stun',
  power: 22,
  armor: 0,
  health: 42,
  recovery: 1,
  blocking: 55,
  mType: 'path',
  mRadius: 4,
  mPass: false,
  aType: 'melee',
  aRange: [1, 1],
  tier: 3,
  features: {
    unblockableStun: true,
  },
});

unitDataMap.set('ChaosDragon', {
  name: 'Chaos Dragon',
  ability: 'Static Charge',
  specialty: 'Regenerate',
  power:28,
  armor:30,
  health:38,
  recovery:1,
  blocking:50,
  mType: 'teleport',
  mRadius: 4,
  mPass: false,
  aType: 'magic',
  aLOS: true,
  aLinear: true,
  aRange: [1, 3],

  baseSprite: 'DragonTyrant',
  imports: ['Sparkle'],
  sounds: {
    heal: 'sprite:core/sounds/sound1203',
    attack: 'sprite:core/sounds/sound1602',
    charge: { src:'charge', rate:0.6 },
    buzz: { src:'buzz', rate:0.6 },
    phase: { src:'sound4', rate:0.5 },
  },
  // The frames used when hatching
  hatch: [
    ['block', 4],
    ['block', 1],
    ['attack', 3],
    ['block', 0],
    ['attack', 4],
    ['attack', 5],
    ['attack', 4],
    ['stand'],
  ],
  tier: 5,
});
