import 'howler';
import 'plugins/pixi.js';
import { Loader } from '@pixi/loaders';
import { Rectangle } from '@pixi/math';

import config from 'config/client.js';
import ServerError from 'server/Error.js';
import clientFactory from 'client/clientFactory.js';
import RemoteTransport from 'tactics/RemoteTransport.js';
import LocalTransport from 'tactics/LocalTransport.js';
import popup from 'components/popup.js';
import Progress from 'components/Progress.js';
import Game from 'tactics/Game.js';
import Setup from 'components/Setup.js';
import unitDataMap, { unitTypeToIdMap } from 'tactics/unitData.js';
import AnimatedSprite from 'tactics/AnimatedSprite.js';
import sleep from 'utils/sleep.js';

const authClient = clientFactory('auth');
const gameClient = clientFactory('game');
const chatClient = clientFactory('chat');
const pushClient = clientFactory('push');

window.Tactics = (function () {
  var self = {};

  Object.assign(self, {
    version: config.version,
    width:  22 + 88*9 + 22,
    height: 44 + 4 + 56*9,
    utils:  {},
    authClient,
    gameClient,
    chatClient,
    pushClient,
    popup,
    Progress: Progress,
    RemoteTransport: RemoteTransport,
    Game: Game,
    ServerError: ServerError,
    loadedUnitTypes: new Set(),
    _setupMap: new Map(),

    load: async function (unitTypes, cb = () => {}) {
      if (!Array.isArray(unitTypes))
        unitTypes = [...unitTypes];
      unitTypes = unitTypes.filter(ut => !AnimatedSprite.has(ut));

      if (!AnimatedSprite.has('core'))
        unitTypes.unshift('core');

      const baseSpriteURL = new URL(process.env.SPRITE_SOURCE, location.href);
      const baseSoundURL = new URL(process.env.SOUND_SOURCE, location.href);
      let progress = 0;
      let effectTypes = new Set();

      const unitsData = await Promise.all(unitTypes.map(async unitType => {
        const unitData = unitDataMap.get(unitType);

        let spriteName;
        if (unitData && unitData.baseSprite)
          spriteName = unitData.baseSprite;
        else
          spriteName = unitType;

        const spriteURL = new URL(`${spriteName}.json`, baseSpriteURL);
        const rsp = await fetch(spriteURL);
        const spriteData = await rsp.json();

        spriteData.name = unitType;

        if (unitData) {
          if (unitData.imports)
            if (spriteData.imports)
              spriteData.imports.push(...unitData.imports);
            else
              spriteData.imports = unitData.imports;
          if (unitData.sounds)
            for (let name of Object.keys(unitData.sounds)) {
              let sound = unitData.sounds[name];
              if (typeof sound === 'string')
                sound = { src:sound };

              sound.name = name;
              if (!sound.src.startsWith('sprite:'))
                sound.src = new URL(`${sound.src}.mp3`, baseSoundURL);

              unitData.sounds[name] = sound;

              spriteData.sounds.push(sound);
            }
        }

        if (spriteData.imports)
          for (let i = 0; i < spriteData.imports.length; i++) {
            effectTypes.add(spriteData.imports[i]);
          }

        progress++;
        cb(
          progress / unitTypes.length * 0.30,
          `Loading unit data...`
        );

        return spriteData;
      }));
      effectTypes = [...effectTypes];
      progress = 0;

      const effectsData = await Promise.all(effectTypes.map(async effectType => {
        const spriteURL = new URL(`${effectType}.json`, baseSpriteURL);
        const rsp = await fetch(spriteURL);
        const spriteData = await rsp.json();

        spriteData.name = effectType;

        progress++;
        cb(
          0.30 + progress / effectTypes.length * 0.20,
          `Loading unit data...`
        );

        return spriteData;
      }));

      AnimatedSprite.dataMap = new Map(
        unitsData.concat(effectsData).map(sd => [sd.name, sd])
      );
      progress = 0;

      for (let unitType of unitTypes) {
        cb(
          0.50 + progress / unitTypes.length * 0.50,
          `Loading ${unitType}...`
        );

        let unitData = unitDataMap.get(unitType);
        try {
          await AnimatedSprite.load(unitType);
        } catch (e) {
          cb(
            0.50 + progress / unitTypes.length * 0.50,
            `Loading failed!`,
          );
          throw e;
        }

        progress++;
      }

      cb(1, `Done!`);
    },
    getSprite: function (spriteName) {
      return AnimatedSprite.get(spriteName);
    },
    playSound: function (name) {
      AnimatedSprite.get('core').getSound(name).howl.play();
    },
    /*
     * This is a shared interface for launching and handling the result of game
     * type setup.  It is only appropriate for online use.
     */
    setup: async function (gameTypeId, setName) {
      let gameType;
      if (typeof gameTypeId !== 'string') {
        gameType = gameTypeId;
        gameTypeId = gameType.id;
      }

      const progress = new Progress();
      const setup = this._setupMap.get(gameTypeId) ?? {};
      setup.whenComplete = new Promise();

      if (!setup.component) {
        progress.percent = 0;
        progress.message = 'Loading set...';
        progress.show();

        // Allow the message to show
        await sleep(200);

        if (!gameType)
          gameType = await gameClient.getGameType(gameTypeId);

        await Tactics.load(
          gameType.getUnitTypes(),
          percent => progress.percent = percent,
        );

        progress.message = 'One moment...';
        // Allow the message to show
        await sleep(200);

        const set = await gameClient.getPlayerSet(gameType.id, setName);
        setup.component = new Setup({ colorId:'Red', set }, gameType)
          .on('back', () => {
            setup.whenComplete.resolve(false);
            setup.component.reset();
          })
          .on('save', ({ data:set }) => {
            let notice = popup({
              message: 'Saving to server...',
              buttons: [],
              closeOnCancel: false,
              autoOpen: 1000, // open after one second
            });

            setup.component.set = set;

            gameClient.savePlayerSet(gameType.id, setName, set).then(() => {
              notice.close();

              setup.whenComplete.resolve(true);
            });
          });

        this._setupMap.set(gameTypeId, setup);

        progress.hide();
      }

      setup.component.show();

      return setup.whenComplete;
    },
    draw: function (data) {
      var types = {C:'Container',G:'Graphics',T:'Text'};
      var elements = {};
      var context = data.context;

      if (!data.children) return;

      for (let [name, pData] of Object.entries(data.children)) {
        let cls = types[pData.type];
        let pixi;

        if (cls == 'Text')
          pixi = new PIXI[cls](
            pData.text || '',
            Object.assign({}, data.textStyle, pData.style),
          );
        else
          pixi = new PIXI[cls]();

        if ('x'        in pData) pixi.position.x = pData.x;
        if ('y'        in pData) pixi.position.y = pData.y;
        if ('visible'  in pData) pixi.visible = pData.visible;
        if ('anchor'   in pData) {
          for (let key in pData['anchor']) {
            if (pData['anchor'].hasOwnProperty(key))
              pixi['anchor'][key] = pData['anchor'][key];
          }
        }
        if ('onSelect' in pData) {
          pixi.interactive = pixi.buttonMode = true;
          pixi.hitArea = new PIXI.Rectangle(0, 0, pData.w, pData.h);
          pixi.click = pixi.tap = () => pData.onSelect.call(pixi,pixi);
        }
        if ('children' in pData)
          Object.assign(
            elements,
            self.draw(
              Object.assign({}, data, { context:pixi, children:pData.children }),
            ),
          );
        if ('draw' in pData)
          pData.draw(pixi);

        context.addChild(elements[name] = pixi);
      }

      return elements;
    },
    createLocalGame: function (stateData) {
      let transport = LocalTransport.createGame(stateData);

      return transport.whenReady.then(() => new Game(transport));
    },
    animations: {
      death: [
        [
          {src:'death.png',pos:{x: 0  ,y:-16  },scale:{x:1.416,y:1.5  },alpha:0.5 }
        ],
        [
          {src:'death.png',pos:{x: 0  ,y:-28  },scale:{x:1.167,y:2.166},alpha:0.69},
          {src:'death.png',pos:{x:-1  ,y:-18  },scale:{x:1.418,y:1.583},alpha:0.5 }
        ],
        [
          {src:'death.png',pos:{x:-0.5,y:-41  },scale:{x:0.956,y:2.833},alpha:0.35},
          {src:'death.png',pos:{x:-2  ,y:-27.5},scale:{x:1.251,y:2.126},alpha:0.69},
          {src:'death.png',pos:{x: 2  ,y:-18  },scale:{x:0.917,y:1.5  },alpha:0.5 }
        ],
        [
          {src:'death.png',pos:{x: 0.5,y:-21  },scale:{x:1.123,y:1.417},alpha:0.5 },
          {src:'death.png',pos:{x:-2  ,y:-38  },scale:{x:1.084,y:2.668},alpha:0.35},
          {src:'death.png',pos:{x: 2  ,y:-32  },scale:{x:0.750,y:2.417},alpha:0.69}
        ],
        [
          {src:'death.png',pos:{x:-0.8,y:-31.7},scale:{x:0.978,y:1.938},alpha:0.69},
          {src:'death.png',pos:{x: 1  ,y:-24  },scale:{x:0.999,y:1.417},alpha:0.5 },
          {src:'death.png',pos:{x: 2  ,y:-46.5},scale:{x:0.584,y:3.291},alpha:0.35}
        ],
        [
          {src:'death.png',pos:{x:-2  ,y:-43.5},scale:{x:0.832,y:2.459},alpha:0.35},
          {src:'death.png',pos:{x: 0  ,y:-36.5},scale:{x:1    ,y:1.958},alpha:0.69},
          {src:'death.png',pos:{x: 1  ,y:-27  },scale:{x:0.998,y:1.5  },alpha:0.5 }
        ],
        [
          {src:'death.png',pos:{x:-0.5,y:-48.5},scale:{x:0.958,y:2.458},alpha:0.35},
          {src:'death.png',pos:{x: 0  ,y:-38.5},scale:{x:0.915,y:2.126},alpha:0.69}
        ],
        [
          {src:'death.png',pos:{x:-0.5,y:-50  },scale:{x:0.791,y:2.752},alpha:0.35}
        ],
      ],
    },
  });

  return self;
})();
