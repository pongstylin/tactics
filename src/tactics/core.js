import clientFactory from 'client/clientFactory.js';
import RemoteTransport from 'tactics/RemoteTransport.js';
import LocalTransport from 'tactics/LocalTransport.js';
import Game from 'tactics/Game.js';
import SetSetup from 'tactics/SetSetup.js';
import unitDataMap, { unitTypeToIdMap } from 'tactics/unitData.js';

var authClient = clientFactory('auth');
var gameClient = clientFactory('game');
var chatClient = clientFactory('chat');

window.Tactics = (function () {
  var self = {};

  // We don't need an infinite loop, thanks.
  PIXI.ticker.shared.autoStart = false;

  $.extend(self, {
    width:  22 + 88*9 + 22,
    height: 44 + 4 + 56*9,
    utils:  {},
    authClient: clientFactory('auth'),
    gameClient: clientFactory('game'),
    chatClient: clientFactory('chat'),
    SetSetup: SetSetup,
    loadedUnitTypes: new Set(),

    load: function (unitTypes, cb = () => {}) {
      return new Promise((resolve, reject) => {
        let resources = [];
        let loaded = 0;
        let loader = PIXI.loader;
        let effects = {};

        let progress = () => {
          let percent = (++loaded / resources.length) * 100;

          cb(percent);

          if (percent === 100)
            resolve();
        };

        this.images.forEach(image_url => {
          let url = image_url;
          if (!url.startsWith('http'))
            url = 'https://legacy.taorankings.com/images/'+url;

          resources.push(url);
          loader.add({ url:url });
        });

        Object.keys(this.sounds).forEach(name => {
          let sound = this.sounds[name];
          if (typeof sound === 'string')
            sound = {file: sound};

          let url = 'https://tactics.taorankings.com/sounds/'+sound.file;

          this.sounds[name] = new Howl({
            src:         [url+'.mp3', url+'.ogg'],
            sprite:      sound.sprite,
            volume:      sound.volume || 1,
            rate:        sound.rate || 1,
            onload:      () => progress(),
            onloaderror: () => {},
          });

          resources.push(url);
        });

        Object.keys(this.effects).forEach(name => {
          let effect_url = this.effects[name].frames_url;

          if (!(effect_url in effects)) {
            resources.push(effect_url);

            effects[effect_url] = fetch(effect_url).then(r => r.json()).then(renderData => {
              // Preload data URIs.
              renderData.images.forEach(image_url => {
                PIXI.BaseTexture.from(image_url);
              });

              progress();
              return renderData;
            });
          }
      
          effects[effect_url].then(renderData => {
            Object.assign(this.effects[name], renderData);
            return renderData;
          });
        });

        let trophy_url = unitDataMap.get('Champion').frames_url;
        resources.push(trophy_url);

        fetch(trophy_url).then(r => r.json()).then(renderData => {
          Object.assign(unitDataMap.get('Champion'), renderData);

          // Preload data URIs.
          renderData.images.forEach(image_url => {
            PIXI.BaseTexture.from(image_url);
          });

          progress();
        });

        for (let unitType of unitTypes) {
          if (this.loadedUnitTypes.has(unitType))
            continue;
          this.loadedUnitTypes.add(unitType);

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
                volume:      sound.volume || 1,
                rate:        sound.rate || 1,
                onload:      () => progress(),
                onloaderror: () => {},
              });

              resources.push(url);
            });
          }

          if (unitData.effects) {
            Object.keys(unitData.effects).forEach(name => {
              let effect_url = unitData.effects[name].frames_url;

              if (!(effect_url in effects)) {
                resources.push(effect_url);

                effects[effect_url] = fetch(effect_url).then(r => r.json()).then(renderData => {
                  // Preload data URIs.
                  renderData.images.forEach(image_url => {
                    PIXI.BaseTexture.from(image_url);
                  });

                  progress();
                  return renderData;
                });
              }
    
              effects[effect_url].then(renderData => {
                Object.assign(unitData.effects[name], renderData);
                return renderData;
              });
            });
          }

          if (unitData.frames_url) {
            let frames_url = unitData.frames_url;
            resources.push(frames_url);

            fetch(frames_url).then(r => r.json()).then(renderData => {
              Object.assign(unitData, renderData);

              // Preload data URIs.
              renderData.images.forEach(image_url => {
                PIXI.BaseTexture.from(image_url);
              });

              progress();
            });
          }
          // Legacy
          else if (unitData.frames) {
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
          }
          // Legacy
          else {
            sprites.push.apply(sprites, Object.values(unitData.stills));

            if (unitData.walks)
              sprites.push.apply(sprites, [].concat.apply([], Object.values(unitData.walks)));

            if (unitData.attacks)
              sprites.push.apply(sprites, [].concat.apply([], Object.values(unitData.attacks)));

            if (unitData.blocks)
              sprites.push.apply(sprites, [].concat.apply([], Object.values(unitData.blocks)));

            sprites.forEach(sprite => {
              Object.keys(sprite).forEach(name => {
                let image = sprite[name];
                if (!image.src) return;

                let url = 'https://legacy.taorankings.com/units/'+unitTypeId+'/'+name+'/image'+image.src+'.png';
                if (resources.includes(url))
                  return;

                resources.push(url);
                loader.add({ url:url });
              });
            });
          }
        }

        loader
          .on('progress', progress)
          .load();
      });
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
    getMyIdentity: function () {
      return authClient.whenReady.then(() => {
        if (!authClient.token) return;

        return {
          id: authClient.playerId,
          name: authClient.playerName,
        };
      });
    },
    joinRemoteGame: function (playerName, gameId) {
      return authClient.setAccountName(playerName)
        .then(() => gameClient.joinGame(gameId));
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
      'https://tactics.taorankings.com/images/board.png',
      'shock.png',
      'particle.png',
      'lightning-1.png',
      'lightning-2.png',
      'lightning-3.png',
      'death.png',
      'turn_tl.png',
      'turn_tr.png', // Inefficient.  Better to flip the tl horizontally.
      'turn_bl.png',
      'turn_br.png'  // Inefficient.  Better to flip the bl horizontally.
    ],
    sounds: {
      victory: 'sound1',
      newturn: 'sound2',
      defeat:  'sound3',
      step:    'sound10',
      block:   'sound11',
      focus:   'sound15',
      select:  'sound14',
      strike:  'sound6',
    },
    effects: {
      focus: {
        frames_url: 'https://tactics.taorankings.com/json/focus.json',
        frames_offset: {y:-16},
      },
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
