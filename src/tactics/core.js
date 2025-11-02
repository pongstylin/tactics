import 'howler';
import 'plugins/pixi.js';

import config, { gameConfig } from 'config/client.js';
import ServerError from 'server/Error.js';
import clientFactory from 'client/clientFactory.js';
import Board from 'tactics/Board.js';
import Game from 'tactics/Game.js';
import Unit from 'tactics/Unit.js';
import unitDataMap from 'tactics/unitData.js';
import unitFactory from 'tactics/unitFactory.js';
import AnimatedSprite from 'tactics/AnimatedSprite.js';
import LocalTransport from 'tactics/LocalTransport.js';
import RemoteTransport from 'tactics/RemoteTransport.js';
import popup from 'components/popup.js';
import Progress from 'components/Modal/Progress.js';
import SetBuilder from 'components/Modal/SetBuilder.js';
import { colorFilterMap } from 'tactics/colorMap.js';
import sleep from 'utils/sleep.js';

const authClient = clientFactory('auth');
const gameClient = clientFactory('game');
const chatClient = clientFactory('chat');
const pushClient = clientFactory('push');

Howler.mute(!gameConfig.audio);

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
    SetBuilder,
    ServerError: ServerError,
    _avatars: { cache:new WeakMap() },

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
        const rsp = await fetch(spriteURL, { retry:true });
        const spriteData = await rsp.json();

        spriteData.name = unitType;
        spriteData.imports ??= [];

        if (unitData) {
          if (unitData.imports)
            spriteData.imports.push(...unitData.imports);
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

        for (let i = 0; i < spriteData.imports.length; i++)
          effectTypes.add(spriteData.imports[i]);

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
        const rsp = await fetch(spriteURL, { retry:true });
        const spriteData = await rsp.json();

        spriteData.name = effectType;
        spriteData.imports ??= [];

        if (unitDataMap.has(effectType)) {
          const unitData = unitDataMap.get(effectType);
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

      unitTypes.sort((a,b) => {
        const aIsImported = unitsData.find(u => u.imports.includes(a));
        const bIsImported = unitsData.find(u => u.imports.includes(b));
        const aUnitData = unitsData.find(u => u.name === a);
        const bUnitData = unitsData.find(u => u.name === b);
        if (a === 'core') return -1;
        if (b === 'core') return 1;
        if (aUnitData.imports.includes(b) && !bUnitData.imports.includes(a) || !aIsImported && bIsImported)
          return 1;
        else if (!aUnitData.imports.includes(b) && bUnitData.imports.includes(a) || aIsImported && !bIsImported)
          return -1;
        return 0;
      });

      for (const unitType of unitTypes) {
        cb(
          0.50 + progress / unitTypes.length * 0.50,
          `Loading ${unitType}...`
        );

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
     * This is a shared interface for launching the set builder.
     * It is only appropriate for online use.
     */
    editSet: async function (data) {
      const progress = new Progress();

      progress.percent = 0;
      progress.message = 'Loading set...';
      progress.show();

      // Allow the message to show
      await sleep(200);

      const promises = [];
      if (typeof data.gameType === 'string')
        promises.push(
          gameClient.getGameType(data.gameType).then(v => data.gameType = v),
        );
      if (typeof data.set === 'string')
        promises.push(
          gameClient.getPlayerSet(data.set).then(v => data.set = v),
        );

      await Promise.all(promises);
      await Tactics.load(
        data.gameType.getUnitTypes(),
        percent => progress.percent = percent,
      );

      progress.message = 'One moment...';

      // Allow the message to show
      await sleep(200);

      progress.close();

      return (await new SetBuilder(data).init()).show();
    },
    draw: function (data) {
      const types = new Map([
        [ 'C', PIXI.Container ],
        [ 'G', PIXI.Graphics ],
        [ 'T', PIXI.Text ],
      ]);
      const elements = {};
      const context = data.context;

      if (!data.children) return;

      for (const [ name, pData ] of Object.entries(data.children)) {
        const constructor = types.get(pData.type);
        let pixi;

        if (constructor === PIXI.Text) {
          const style = Object.assign({}, data.textStyle, pData.style);

          if ('w' in pData) {
            style.wordWrap = true;
            style.wordWrapWidth = pData.w;
          }

          pixi = new constructor({ text:pData.text ?? '', style });
        } else
          pixi = new constructor();

        if ('x'        in pData) pixi.position.x = pData.x;
        if ('y'        in pData) pixi.position.y = pData.y;
        if ('visible'  in pData) pixi.visible = pData.visible;
        if ('anchor'   in pData) {
          Object.assign(pixi.anchor, pData.anchor);
        }
        if ('onSelect' in pData) {
          pixi.interactive = true;
          pixi.cursor = 'pointer';
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

      return transport.whenReady.then(() => new Game(transport).init());
    },
    async makeAvatarRenderer() {
      return this._avatars.renderer = await PIXI.autoDetectRenderer({});
    },
    drawAvatar(avatar, options, transform = null) {
      options = Object.assign({
        renderer: avatar instanceof Unit ? Tactics.game.renderer : Tactics.game?.renderer ?? this._avatars.renderer,
        as: 'image',
        direction: 'S',
        withFocus: false,
        withShadow: false,
        withHighlight: false,
      }, options);

      const unit = (() => {
        if (avatar instanceof Unit) {
          // Use a clone to ignore transient effects
          const unit = avatar.clone().draw();
          unit.color = avatar.color;
          return unit;
        } else if (options.as === 'image' && AnimatedSprite.has('avatars')) {
          if (!this._avatars.board)
            this._avatars.board = new Board().draw();

          const unit = unitFactory(avatar.unitType, this._avatars.board);
          unit.color = colorFilterMap.get(avatar.colorId);

          const spriteName = unit.baseSprite ?? unit.type;
          const superSpriteName = unit.type === 'DragonspeakerMage' ? 'Pyromancer' : spriteName;
          unit.spriteSource = 'avatars';
          unit.spriteName = spriteName;
          unit.unitSprite = `${superSpriteName}Unit`;
          unit.trimSprite = `${superSpriteName}Trim`;
          unit.shadowSprite = `${superSpriteName}Shadow`;
          return unit;
        } else if (Tactics.game) {
          const unit = unitFactory(avatar.unitType, Tactics.game.board);
          unit.color = colorFilterMap.get(avatar.colorId);
          return unit;
        }

        throw new Error('Unable to render avatar');
      })();
      const unitKey =
        unit.color === null ? `${unit.type}:null` : Object.keys(unit.filters).length === 0
          ? `${unit.type}:${unit.color.toString()}`
          : `${unit.type}:${unit.color.toString()}:${Object.entries(unit.filters).map(([ name, filter ]) => {
            if (filter instanceof PIXI.filters.ColorMatrixFilter)
              return `${name}=${filter.matrix.map(v => v.toFixed(2)).join(',')}`;
            else
              return `${name}`;
          }).join(';')}`;
      const cacheKey = [
        unitKey,
        options.as,
        options.direction,
        options.withFocus,
        options.withShadow,
        options.withHighlight,
      ].join(':');

      if (!this._avatars.cache.has(options.renderer))
        this._avatars.cache.set(options.renderer, new Map());

      const cache = this._avatars.cache.get(options.renderer);

      if (!cache.has(cacheKey))
        if (transform)
          cache.set(cacheKey, transform(unit.drawAvatar(options)));
        else
          cache.set(cacheKey, unit.drawAvatar(options));

      return cache.get(cacheKey);
    },
    getAvatarImage(avatar, options) {
      const avatarImageData = this.drawAvatar(avatar, Object.assign({ withFocus:true }, options));
      const imgAvatar = document.createElement('IMG');
      imgAvatar.dataset.avatar = JSON.stringify(avatarImageData);
      imgAvatar.style.top = `${avatarImageData.y}px`;
      imgAvatar.style.left = `${avatarImageData.x}px`;
      imgAvatar.style.transformOrigin = `${-avatarImageData.x}px ${-avatarImageData.y}px`;
      imgAvatar.src = avatarImageData.src;

      return imgAvatar;
    },
    shrinkDataURI(dataURI) {
      let parts = dataURI.slice(5).split(';base64,');
      let mimeType = parts[0];
      let base64Data = parts[1];
      let byteString = atob(base64Data);
      let bytesCount = byteString.length;
      let bytes = new Uint8Array(bytesCount);
      for (let i = 0; i < bytesCount; i++) {
        bytes[i] = byteString[i].charCodeAt(0);
      }
      let blob = new Blob([bytes], { type:mimeType });

      return URL.createObjectURL(blob);
    },
    makeCanvasSourceFromURL(url) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        image.src = url;
      }).then(image => {
        const canvas = document.createElement('CANVAS');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, image.width, image.height);
        return new PIXI.CanvasSource({ resource:canvas });
      });
    },
    makeCanvasSourceFromDataURI(uri) {
      return this.makeCanvasSourceFromURL(Tactics.shrinkDataURI(uri));
    },
  });

  return self;
})();
