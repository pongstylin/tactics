import clientFactory from 'client/clientFactory.js';
import RemoteTransport from 'tactics/RemoteTransport.js';
import LocalTransport from 'tactics/LocalTransport.js';
import Game from 'tactics/Game.js';

var authClient = clientFactory('auth');
var gameClient = clientFactory('game');
var refreshTimeout = null;

authClient.on('token', ({ token }) => {
  authClient.authorize();
  gameClient.authorize(token);

  // Being lazy and assuming a 1h token expiration period.
  // So we'll refresh in 45 minutes.
  clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(() => authClient.refreshToken(), 45 * 60000);
});

authClient.refreshTokenIfPresent();

window.Tactics = (function () {
  'use strict';

  var self = {};

  // We don't need an infinite loop, thanks.
  PIXI.ticker.shared.autoStart = false;

  $.extend(self, {
    width:  22 + 88*9 + 22,
    height: 44 + 4 + 56*9,
    utils:  {},
    authClient: clientFactory('auth'),
    gameClient: clientFactory('game'),

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
          child.click = child.tap = function () { v.onSelect.call(child,child); };
        }
        if ('children' in v) $.extend(elements,self.draw($.extend({},data,{context:child,children:v.children})));
        if ('draw'     in v) v.draw(child);

        context.addChild(elements[k] = child);
      });

      return elements;
    },
    createLocalGame: function (stateData) {
      let transport = LocalTransport.createGame(stateData);
      let localTeamIds = stateData.teams
        .filter(team => !team.bot)
        .map((team, i) => i);

      return transport.whenReady
        .then(() => new Game(transport, localTeamIds));
    },
    getRemoteGameData: function (gameId) {
      return gameClient.getGameData(gameId);
    },
    getMyIdentity: function () {
      if (!authClient.token) return Promise.resolve();

      return Promise.resolve({
        id: authClient.userId,
        name: authClient.userName,
      });
    },
    joinRemoteGame: function (playerName, gameId) {
      return authClient.setAccountName(playerName)
        .then(() => gameClient.joinGame(gameId));
    },
    loadRemoteGame: function (gameId, gameData) {
      let promise;
      if (gameData)
        promise = Promise.resolve(gameData);
      else
        promise = gameClient.getGameData(gameId);

      return promise.then(gameData => {
        let transport = new RemoteTransport(gameData);
        let localTeamIds = gameData.state.teams
          .filter(team => team.playerId === authClient.userId)
          .map(team => team.originalId);

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
