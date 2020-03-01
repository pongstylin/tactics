import 'howler';
import 'plugins/pixi.js';
import { Texture } from '@pixi/core';
import { Loader } from '@pixi/loaders';

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

var authClient = clientFactory('auth');
var gameClient = clientFactory('game');
var chatClient = clientFactory('chat');

window.Tactics = (function () {
  var self = {};

  $.extend(self, {
    version: config.version,
    width:  22 + 88*9 + 22,
    height: 44 + 4 + 56*9,
    utils:  {},
    authClient: clientFactory('auth'),
    gameClient: clientFactory('game'),
    chatClient: clientFactory('chat'),
    Progress: Progress,
    ServerError: ServerError,
    loadedUnitTypes: new Set(),
    spriteMap: new Map(),
    _setupMap: new Map(),
    _resolveSetup: null,

    load: async function (unitTypes, cb = () => {}) {
      if (!Array.isArray(unitTypes))
        unitTypes = [...unitTypes];
      unitTypes = unitTypes.filter(ut => !this.spriteMap.has(ut));

      if (!this.spriteMap.has('core'))
        unitTypes.unshift('core');

      if (unitTypes.find(ut => ut === 'ChaosSeed'))
        unitTypes.push('ChaosDragon');

      let baseURL = new URL(process.env.SPRITE_SOURCE, location.href);
      let progress = 0;
      let effectTypes = new Set();

      let unitsData = await Promise.all(unitTypes.map(unitType => {
        let unitData = unitDataMap.get(unitType);
        if (unitData && unitData.legacy) {
          if (unitData.imports)
            unitData.imports.forEach(effectType => effectTypes.add(effectType));

          return this.loadLegacySprite(unitType);
        }

        let spriteURL = new URL(`${unitType}.json`, baseURL);

        return fetch(spriteURL).then(rsp => rsp.json()).then(data => {
          data.name = unitType;
          if (data.imports)
            for (let i = 0; i < data.imports.length; i++) {
              effectTypes.add(data.imports[i]);
            }

          progress++;
          cb(
            progress / unitTypes.length * 0.30,
            `Loading unit data...`
          );

          return data;
        });
      }));
      unitsData = unitsData.filter(ud => !!ud);
      effectTypes = [...effectTypes];
      progress = 0;

      let effectsData = await Promise.all(effectTypes.map(effectType => {
        let spriteURL = new URL(`${effectType}.json`, baseURL);

        return fetch(spriteURL).then(rsp => rsp.json()).then(data => {
          data.name = effectType;

          progress++;
          cb(
            0.30 + progress / effectTypes.length * 0.20,
            `Loading unit data...`
          );

          return data;
        });
      }));

      let spriteDataMap = new Map(
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
          if (unitData && unitData.legacy) {
            if (unitData.imports)
              for (let spriteName of unitData.imports) {
                await this.loadSprite(spriteDataMap, spriteName);
              }
          }
          else
            await this.loadSprite(spriteDataMap, unitType);
        }
        catch (e) {
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
    loadSprite: async function (spriteDataMap, spriteName) {
      if (this.spriteMap.has(spriteName))
        return;

      let spriteData = spriteDataMap.get(spriteName);

      if (spriteData.imports)
        for (let i = 0; i < spriteData.imports.length; i++) {
          await this.loadSprite(spriteDataMap, spriteData.imports[i]);
        }

      await new Promise((resolve, reject) => {
        let loading = 0;
        let loaded = -1;
        let progress = () => {
          loaded++;
          if (loading === loaded)
            resolve();
        };

        if (spriteData.images)
          for (let i = 0; i < spriteData.images.length; i++) {
            let image = spriteData.images[i];
            if (typeof image === 'string')
              image = spriteData.images[i] = { src:image };

            if (!image.name)
              image.name = [];
            else if (typeof image.name === 'string')
              image.name = [image.name];

            if (image.src.startsWith('sprite:'))
              image.texture = this.getSpriteURI(image.src).texture;
            else if (image.src.startsWith('data:')) {
              image.texture = Texture.from( this.shrinkDataURI(image.src) );
              if (!image.texture.baseTexture.valid) {
                loading++;
                image.texture.baseTexture
                  .on('loaded', progress)
                  .on('error', () =>
                    reject(new Error(
                      `Failed to load sprite:${spriteName}/images/${i}`
                    ))
                  );
              }
            }
            else
              throw 'Unsupported image source';
            delete image.src;
          }

        if (spriteData.sounds)
          for (let i = 0; i < spriteData.sounds.length; i++) {
            let sound = spriteData.sounds[i];
            if (typeof sound === 'string')
              sound = spriteData.sounds[i] = { src:sound };

            if (!sound.name)
              sound.name = [];
            else if (typeof sound.name === 'string')
              sound.name = [sound.name];

            if (sound.src.startsWith('sprite:'))
              sound.howl = this.getSpriteURI(sound.src).howl;
            else if (sound.src.startsWith('data:')) {
              loading++;
              sound.howl = new Howl({
                src: [ this.shrinkDataURI(sound.src) ],
                format: 'mp3',
                volume: parseFloat(process.env.VOLUME_SCALE) || 1,
                onload: progress,
                onloaderror: (id, error) =>
                  reject(new Error(
                    `Failed to load sprite:${spriteName}/sounds/${i}: ${id}, ${error}`
                  )),
              });
            }
            else
              throw 'Unsupported sound source';
            delete sound.src;
          }

        progress();
      });

      this.spriteMap.set(spriteName, new AnimatedSprite(spriteData));
    },
    loadLegacySprite: async function (unitType) {
      if (this.loadedUnitTypes.has(unitType))
        return;
      this.loadedUnitTypes.add(unitType);

      return new Promise((resolve, reject) => {
        let resources = [];
        let loaded = 0;
        let loader = new Loader();
        let effects = {};

        let progress = () => {
          let percent = (++loaded / resources.length) * 100;

          if (percent === 100)
            resolve();
        };

        let unitData   = unitDataMap.get(unitType);
        let unitTypeId = unitTypeToIdMap.get(unitType);
        let sprites    = [];

        if (unitData.sounds) {
          Object.keys(unitData.sounds).forEach(name => {
            let sound = unitData.sounds[name];
            if (typeof sound === 'string')
              sound = {file: sound};

            let url = 'https://tactics.taorankings.com/sounds/'+sound.file;

            unitData.sounds[name] = new Howl({
              src:         [url+'.mp3', url+'.ogg'],
              sprite:      sound.sprite,
              volume:      (sound.volume || 1) * (process.env.VOLUME_SCALE || 1),
              rate:        sound.rate || 1,
              onload:      () => progress(),
              onloaderror: () => {},
            });

            resources.push(url);
          });
        }

        unitData.frames.forEach(frame => {
          if (!frame) return;

          frame.c.forEach(sprite => {
            let url = 'https://legacy.taorankings.com/units/'+unitTypeId+'/image'+sprite.id+'.png';
            if (resources.includes(url))
              return;

            resources.push(url);
            loader.add({ url:url });
          });
        });

        if (resources.length === 0)
          resolve();
        else {
          loader
            .on('progress', progress)
            .load();
        }
      });
    },
    shrinkDataURI: function (dataURI) {
      let parts = dataURI.slice(5).split(';base64,');
      let mimeType = parts[0];
      let base64Data = parts[1];
      let byteString = atob(base64Data);
      let bytesCount = byteString.length;
      let bytes = new Uint8Array(bytesCount);
      for (var i = 0; i < bytesCount; i++) {
        bytes[i] = byteString[i].charCodeAt(0);
      }
      let blob = new Blob([bytes], { type:mimeType });

      return URL.createObjectURL(blob);
    },
    getSpriteURI: function (path) {
      let parts = path.replace(/^sprite:/, '').split('/');
      if (parts.length === 3) {
        let [spriteName, memberName, elementIndex] = parts;
        let member = this.spriteMap.get(spriteName)[memberName];
        if (typeof elementIndex === 'number')
          return member[elementIndex];
        else
          return member.find(e => e.name.includes(elementIndex));
      }
      else if (parts.length === 2) {
        let [spriteName, memberName] = parts;
        return this.spriteMap.get(spriteName)[memberName];
      }
      else if (parts.length === 1)
        return this.spriteMap.get(parts[0]);

      return null;
    },
    playSound: function (name) {
      this.spriteMap.get('core').getSound(name).howl.play();
    },
    /*
     * This is a shared interface for launching and handling the result of game
     * type setup.  It is only appropriate for online use.
     */
    setup: async function (gameType) {
      let progress = new Progress();
      let setup = this._setupMap.get(gameType);
      let promise = new Promise(r => this._resolveSetup = r);

      if (!setup) {
        progress.percent = 0;
        progress.message = 'Loading set...';
        progress.show();

        // Allow the message to show
        await sleep(200);

        let gameTypeConfig = await gameClient.getGameTypeConfig(gameType);

        await Tactics.load(
          gameTypeConfig.limits.units.types.keys(),
          percent => progress.percent = percent,
        );

        progress.message = 'One moment...';
        // Allow the message to show
        await sleep(200);

        let defaultSet = await gameClient.getDefaultPlayerSet(gameType);
        setup = new Setup({
          colorId: 'Red',
          set: defaultSet,
        }, gameTypeConfig);
        setup.on('back', () => {
          this._resolveSetup(false);

          setup.reset();
        });
        setup.on('save', ({ data:set }) => {
          let notice = popup({
            message: 'Saving to server...',
            buttons: [],
            closeOnCancel: false,
            autoOpen: 1000, // open after one second
          });

          gameClient.saveDefaultPlayerSet(gameType, set).then(() => {
            notice.close();

            this._resolveSetup(true);
          });
        });

        this._setupMap.set(gameType, setup);

        progress.hide();
      }

      setup.show();

      return promise;
    },
    draw: function (data) {
      var types = {C:'Container',G:'Graphics',T:'Text'};
      var elements = {};
      var context = data.context;

      if (!data.children) return;

      $.each(data.children, function (k,v) {
        var cls = types[v.type];
        var child;

        if (cls == 'Text') {
          child = new PIXI[cls](v.text || '',$.extend({},data.textStyle,v.style || {}));
        }
        else {
          child = new PIXI[cls]();
        }

        if ('x'        in v) child.position.x = v.x;
        if ('y'        in v) child.position.y = v.y;
        if ('visible'  in v) child.visible = v.visible;
        if ('anchor'   in v) {
          for (let key in v['anchor']) {
            if (v['anchor'].hasOwnProperty(key))
              child['anchor'][key] = v['anchor'][key];
          }
        }
        if ('onSelect' in v) {
          child.interactive = child.buttonMode = true;
          child.hitArea = new PIXI.Rectangle(0,0,v.w,v.h);
          child.click = child.tap = () => v.onSelect.call(child,child);
        }
        if ('children' in v) $.extend(elements,self.draw($.extend({},data,{context:child,children:v.children})));
        if ('draw'     in v) v.draw(child);

        context.addChild(elements[k] = child);
      });

      return elements;
    },
    createLocalGame: function (stateData) {
      let transport = LocalTransport.createGame(stateData);

      return transport.whenReady.then(() => {
        let localTeamIds = transport.teams
          .filter(team => !team.bot)
          .map(team => team.originalId);

        return new Game(transport, localTeamIds);
      });
    },
    getRemoteGameData: function (gameId) {
      return gameClient.getGameData(gameId);
    },
    joinRemoteGame: function (playerName, gameId, set) {
      return authClient.setAccountName(playerName)
        .then(() => gameClient.joinGame(gameId, { set }));
    },
    loadRemoteGame: function (gameId, gameData) {
      let transport = new RemoteTransport(gameId, gameData);

      return transport.whenReady.then(() => {
        let localTeamIds = transport.teams
          .filter(t => t && t.playerId === authClient.playerId)
          .map(t => t.originalId);

        return new Game(transport, localTeamIds);
      });
    },
    images: [
      'turn_tl.png',
      'turn_tr.png', // Inefficient.  Better to flip the tl horizontally.
      'turn_bl.png',
      'turn_br.png'  // Inefficient.  Better to flip the bl horizontally.
    ],
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
