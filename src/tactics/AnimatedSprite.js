import emitter from 'utils/emitter.js';

/*
 * Every AnimatedSprite has a PIXI container.
 * Every frame has a PIXI container.
 * When a frame is played, the frame container becomes the only child of the AnimatedSprite container.
 * The AnimatedSprite container always has one child: a frame container.
 */
export default class AnimatedSprite {
  constructor(data, params) {
    this._renders = new Map();

    this._normalize(data);
  }

  /*
   * Before loading sprites, one must first assign the static 'dataMap' property
   * to all required sprite data objects.
   */
  static async load(spriteName) {
    if (this.spriteMap.has(spriteName))
      return;

    const spriteData = this.dataMap.get(spriteName);
    const promises = [];

    if (spriteData.images) {
      const imagePromises = spriteData.images.map(() => new Promise());

      spriteData.images.forEach(async (imageData, i) => {
        if (typeof imageData === 'string')
          imageData = spriteData.images[i] = { src:imageData };

        if (!imageData.name)
          imageData.name = [];
        else if (typeof imageData.name === 'string')
          imageData.name = [ imageData.name ];

        if (imageData.type === 'sheet') {
          if (imageData.src.startsWith('data:')) {
            try {
              imageData.canvasSource = await Tactics.makeCanvasSourceFromDataURI(imageData.src);
            } catch (e) {
              imagePromises[i].reject(new Error(`Failed to load sprite:${spriteName}/images/${i}`));
            }
          } else
            imagePromises[i].reject('Unsupported image source for sheet');
        } else if (imageData.type === 'frame') {
          imageData.texture = new PIXI.Texture({
            source: (await imagePromises[imageData.src]).canvasSource,
            frame: new PIXI.Rectangle(imageData.x, imageData.y, imageData.width, imageData.height),
          });
        } else if (imageData.type === undefined) {
          // By default the imageData is a texture
          if (imageData.src.startsWith('sprite:'))
            imageData.texture = AnimatedSprite.get(imageData.src).texture;
          else if (imageData.src.startsWith('data:')) {
            try {
              const source = await Tactics.makeCanvasSourceFromDataURI(imageData.src);
              imageData.texture = new PIXI.Texture({ source });
            } catch (e) {
              imagePromises[i].reject(new Error(`Failed to load sprite:${spriteName}/images/${i}`));
            }
          } else
            imagePromises[i].reject('Unsupported image source');
        } else if (imageData.type === 'image') {
          // Ordinary images are not used in sprites
          imageData.src = Tactics.shrinkDataURI(imageData.src);
          return imagePromises[i].resolve(imageData);
        } else
          imagePromises[i].reject('Unsupported image type');

        delete imageData.src;

        imagePromises[i].resolve(imageData);
      });

      promises.push(...imagePromises);
    }

    if (spriteData.sounds) {
      const VOLUME_SCALE = parseFloat(process.env.VOLUME_SCALE) || 1;
      const soundPromises = spriteData.sounds.map(() => new Promise());

      spriteData.sounds.forEach(async (soundData, i) => {
        if (typeof soundData === 'string')
          soundData = spriteData.sounds[i] = { src:soundData };

        if (!soundData.name)
          soundData.name = [];
        else if (typeof soundData.name === 'string')
          soundData.name = [soundData.name];

        const isURL = soundData.src instanceof URL;
        const isDataURL = !isURL && soundData.src.startsWith('data:');
        const isSpriteURI = !isURL && soundData.src.startsWith('sprite:');
        const isCustom = soundData.volume !== undefined || soundData.rate !== undefined;

        if (isURL || isDataURL || isCustom) {
          if (isURL)
            soundData.src = soundData.src.toString();
          else if (isDataURL)
            soundData.src = Tactics.shrinkDataURI(soundData.src);
          else if (isSpriteURI)
            soundData.src = AnimatedSprite.get(soundData.src).howl._src;

          const soundName = soundData.name[0] || i;

          await new Promise((resolve, reject) => {
            soundData.howl = new Howl({
              src: [ soundData.src ],
              format: 'mp3',
              volume: (soundData.volume || 1) * VOLUME_SCALE,
              rate: soundData.rate || 1,
              sprite: soundData.sprite,
              onload: resolve,
              onloaderror: (id, error) => {
                if (error === 'Decoding audio data failed.') {
                  if (!Tactics.audioBroken)
                    console.warn('Audio is broken in this browser');
                  Tactics.audioBroken = true;
                } else
                  soundPromises[i].reject(new Error(
                    `Failed to load sprite:${spriteName}/sounds/${soundName}: ${id}, ${error}`
                  ));
              },
            });
          });
        } else if (isSpriteURI) {
          soundData.howl = AnimatedSprite.get(soundData.src).howl;
        } else
          soundPromises.reject('Unsupported sound source');

        delete soundData.src;

        soundPromises[i].resolve(soundData);
      });

      promises.push(...soundPromises);
    }

    await Promise.all(promises);

    this.spriteMap.set(spriteName, new AnimatedSprite(spriteData));

    // Import imports after the sprite so that imports can depend on the parent sprite being present.
    // E.g. Trophy is an import of core and requires a source from core.
    if (spriteData.imports)
      await Promise.all(spriteData.imports.map(importData => this.load(importData)));
  }

  static has(spriteName) {
    return this.spriteMap.has(spriteName);
  }
  static get(path) {
    if (path.startsWith('sprite:')) {
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
    }
    else {
      return this.spriteMap.get(path);
    }
  }

  get name() {
    return this._data.sprites[0].name;
  }

  get images() {
    return this._data.images;
  }
  get sounds() {
    return this._data.sounds;
  }
  get sprites() {
    return this._data.sprites;
  }
  get frames() {
    return this._data.sprites[0].frames;
  }

  getAction(actionName) {
    return this._data.sprites[0].actions[actionName];
  }
  getImage(name) {
    return this._data.images.find(i => i.name.includes(name));
  }
  getSound(name) {
    return this._data.sounds.find(s => s.name.includes(name));
  }

  hasAction(actionName, options = {}) {
    let sprites = this._data.sprites;

    let sprite;
    if (options.spriteName === undefined || options.spriteName === null)
      sprite = sprites[0];
    else {
      sprite = sprites.find(s => s.name === options.spriteName);
      if (!sprite)
        throw `No sprite called ${options.spriteName} in ${this.name}`;
    }

    return sprite.actions && sprite.actions[actionName];
  }
  renderAnimation(options) {
    let { sprites, sprite, action, framesData } = this._getSpriteData(options);
    let container = options.container;
    let anim;

    if (action && action.loop) {
      anim = new Tactics.Animation({ loop:true });
      let index = 0;

      anim.addFrame(() => {
        let frame = this._renderFrame(
          sprites,
          sprite.name,
          sprite.frames,
          index++,
          options,
        );

        if (options.fixup)
          options.fixup(frame);

        frame.scripts.forEach(s => s());

        container.removeChildren();
        container.addChild(frame.container);
      });
    }
    else {
      anim = new Tactics.Animation();

      let frames = framesData.map(frameData => {
        let frame = this._renderFrame(
          sprites,
          sprite.name,
          sprite.frames,
          frameData.id,
          options,
        );

        if (options.fixup)
          options.fixup(frame);

        return [
          ...frame.scripts,
          () => {
            container.removeChildren();
            container.addChild(frame.container);
          },
        ];
      });

      anim.addFrames(frames);
    }

    return anim;
  }
  renderFrame(options) {
    let { sprites, sprite, framesData } = this._getSpriteData(options);
    let frameId = options.frameId || 0;
    let frame = this._renderFrame(
      sprites,
      sprite.name,
      sprite.frames,
      framesData[frameId].id,
      options,
    );

    if (options.fixup)
      options.fixup(frame);

    return frame;
  }

  _getSpriteData(options) {
    let sprites = this._compile();

    let sprite;
    if (options.spriteName === undefined || options.spriteName === null)
      sprite = sprites[0];
    else {
      sprite = sprites.find(s => s.name === options.spriteName);
      if (!sprite)
        throw `No sprite called ${options.spriteName} in ${this.name}`;
    }

    let offset = 0;
    if (options.direction !== undefined) {
      let directions;
      let index;

      switch (sprite.name) {
        case 'LightningWard':
        case 'BarrierWard':
        case 'WyvernEgg':
        case 'Shrub':
          offset = 0;
          break;
        case 'Trophy':
          directions = ['S','N'];
          index = directions.indexOf(options.direction);
          if (index === -1)
            throw 'Invalid direction option';

          offset = index * sprite.frames.length / 2;
          break;
        default:
          directions = ['S','W','N','E'];
          index = directions.indexOf(options.direction);
          if (index === -1)
            throw 'Invalid direction option';

          offset = index * sprite.frames.length / 4;
      }
    }

    let framesData;
    let action;
    if (options.actionName === undefined)
      framesData = sprite.frames;
    else {
      framesData = [];

      action = sprite.actions && sprite.actions[options.actionName];
      if (!action)
        throw `No action called ${options.actionName} in ${this.name}`;

      action.clips.forEach(clip => {
        let start = offset + clip[0];
        let end = start + clip[1];

        framesData.push(...sprite.frames.slice(start, end))
      });
    }

    return { sprites, sprite, action, framesData };
  }

  /*
   * Data can be abbreviated in a number of ways.  This converts many variations
   * into a single representation of the data.
   */
  _normalize(data) {
    this._data = data;

    /*
     * Normalize the sounds
     */
    if (data.sounds)
      for (let soundId = 0; soundId < data.sounds.length; soundId++) {
        let sound = data.sounds[soundId];
        if (sound.name === undefined)
          sound.name = [];
        else if (typeof sound.name === 'string')
          sound.name = [sound.name];
      }
    else
      data.sounds = [];

    /*
     * Normalize the sprites
     */
    for (let spriteId = 0; spriteId < data.sprites.length; spriteId++) {
      this._normalizeSprite(data, spriteId);
    }

    /*
     * Normalize the buttons
     */
    if (!data.buttons)
      data.buttons = [];
    for (let buttonId = 0; buttonId < data.buttons.length; buttonId++) {
      this._normalizeButton(data, buttonId);
    }

    /*
     * Clean up sprite metadata
     */
    for (let sprite of data.sprites) {
      delete sprite.frameCount;
      delete sprite.isNormal;
      delete sprite.isUsed;
    }
  }
  _normalizeSprite(data, spriteId) {
    let sprite;

    if (typeof spriteId !== 'number')
      return AnimatedSprite.get(spriteId);

    sprite = data.sprites[spriteId];

    // A sprite may already be normalized if used by another sprite.
    if (sprite.isNormal) return sprite;

    sprite.id = spriteId;

    /*
     * Normalize the actions
     */
    if (sprite.actions) {
      for (let actionName in sprite.actions) {
        let action = sprite.actions[actionName];
        if (typeof action !== 'object' || Array.isArray(action))
          action = sprite.actions[actionName] = { clips:[action] };
        if (action.clips === undefined)
          action.clips = [[0, sprite.frames.length]];

        for (let i = 0; i < action.clips.length; i++) {
          let clip = action.clips[i];
          if (!Array.isArray(clip))
            clip = action.clips[i] = [clip, 1];

          if (typeof clip[0] === 'string') {
            clip[0] = sprite.frames.findIndex(f => f.name === clip[0]);
            if (clip[0] === -1)
              throw 'Unable to find frame by name';
          }
        }

        if (typeof action.effect === 'string')
          action.effect = { spriteId:action.effect };

        if (action.sounds)
          action.sounds = this._compileSounds(data, action.sounds);
      }
    }

    /*
     * Normalize the frames
     */
    this._normalizeFrames(data, sprite.frames);

    let previousLayers = sprite.frames.last.layers;

    while (sprite.frameCount > sprite.frames.length) {
      let newFrame = { id:sprite.frames.length };
      if (previousLayers)
        newFrame.layers = previousLayers.map(l => ({...l}));

      sprite.frames.push(newFrame);
    }

    sprite.isNormal = true;

    // Pre-compile sprites that don't have scripts
    if (!sprite.scripts)
      this._compileSprite(sprite);

    return sprite;
  }
  _normalizeButton(data, buttonId) {
    let button = data.buttons[buttonId];

    button.up = this._normalizeFrames(data, [button.up])[0];
    button.over = this._normalizeFrames(data, [button.over])[0];
    button.down = this._normalizeFrames(data, [button.down])[0];

    return button;
  }
  _normalizeFrames(data, frames) {
    frames.forEach((frame, frameId) => {
      /*
       * Make sure every frame is an object with an id
       */
      if (Array.isArray(frame))
        frames[frameId] = frame = { id:frameId, layers:frame };
      if (frame.id === undefined)
        frame.id = frameId;

      let previousLayers = frameId > 0 ? frames[frameId-1].layers || [] : [];
      let layers = frame.layers || [];

      /*
       * Frame-level transforms and colors are not inherited by subsequent frames
       */
      normalizeTransform(frame);
      normalizeColor(frame);

      /*
       * Fill in blank frames
       */
      for (let i = frameId; i < frame.id; i++) {
        let newFrame = { id:i };
        if (previousLayers.length)
          newFrame.layers = previousLayers.map(l => ({...l}));

        frames.splice(frameId, 0, newFrame);
      }

      /*
       * Normalize unit data
       */
      if (frame.unit) {
        normalizeTransform(frame.unit);
        normalizeColor(frame.unit);
      }

      /*
       * Normalize the sounds
       */
      if (frame.sounds)
        frame.sounds = this._compileSounds(data, frame.sounds);

      /*
       * Normalize the layers
       */
      if (frame.layers)
        frame.layers.forEach(layer => {
          if (layer.depth === undefined)
            layer.depth = 0;
        });

      let depths = [];
      previousLayers.forEach(l => depths[l.depth] = l.depth);
      layers.forEach(l => depths[l.depth] = l.depth);

      depths.forEach(depth => {
        let previousLayer = previousLayers.find(l => l.depth === depth) || {};
        let layer = layers.find(l => l.depth === depth);

        if (layer) {
          if (layer.type === 'remove') {
            layers.splice(layers.indexOf(layer), 1);
            return;
          }

          /*
           * Scripted sprites must not be shared between multiple layers
           */
          if (layer.type === 'sprite') {
            let spriteData = this._normalizeSprite(data, layer.spriteId);
            if (spriteData.scripts) {
              if (spriteData.isUsed) {
                let cloneSpriteData = JSON.clone(spriteData);
                cloneSpriteData.id = data.sprites.length;
                data.sprites.push(cloneSpriteData);

                layer.spriteId = cloneSpriteData.id;
              }
              else
                spriteData.isUsed = true;
            }
          }

          normalizeTransform(layer, previousLayer.transform);
          normalizeColor(layer, previousLayer.color);

          if (layer.type === undefined) {
            layer.type = previousLayer.type;

            if (layer.type === 'sprite') {
              if (layer.spriteId === undefined)
                layer.spriteId = previousLayer.spriteId;
            }
            else if (layer.type === 'image') {
              if (layer.imageId === undefined)
                layer.imageId = previousLayer.imageId;
            }
            else if (layer.type === 'button') {
              if (layer.buttonId === undefined)
                layer.buttonId = previousLayer.buttonId;
            }
          }

          if (layer.name === undefined && previousLayer.name !== undefined)
            layer.name = previousLayer.name;
        }
        else {
          layer = Object.assign({}, previousLayer);
          layers.push(layer);
        }
      });

      if (layers.length) {
        layers.sort((a, b) => a.depth - b.depth);
        frame.layers = layers;
      }
      else if (frame.layers)
        delete frame.layers;
    });

    return frames;
  }

  _compile() {
    let sprites = [];

    for (let sprite of this._data.sprites) {
      // Scripted sprites must be compiled every time they are rendered
      if (sprite.scripts)
        sprite = this._compileSprite(sprite);

      sprites.push(sprite);
    }

    return sprites;
  }
  _compileSprite(sprite) {
    let data = this._data;

    if (sprite.scripts) {
      // Only modify a copy of the original data
      sprite = JSON.clone(sprite);

      sprite.scripts.forEach(script => {
        /*
         * Apply randomness to when and where a sub sprite starts.
         *
         * Example: Sparkle
         *   {
         *     "name":"offsetStart",
         *     "layer":[ "s0", "s2", "s1" ],
         *     "randomOffset": [
         *       { "range":[2,3] },
         *       { "range":[5,3] },
         *       { "range":[8,3] }
         *     ]
         *   }
         *
         * Example: Lightning
         *   {
         *     "name":"offsetStart",
         *     "layer":"fx",
         *     "randomStart": {
         *       "range":[0,6]
         *     }
         *   }
         */
        if (script.name === 'offsetStart') {
          // The sprite may exist on one or more layers
          let layerNames = script.layer;
          if (Array.isArray(script.layer))
            layerNames = script.layer.slice();
          else
            layerNames = [layerNames];

          // Randomize which layer gets which random offset or start
          layerNames.shuffle();

          for (let i = 0; i < layerNames.length; i++) {
            let layerName = layerNames[i];

            // Randomize the sub sprite starting frameId (useful for looped sprites)
            if (script.randomStart) {
              let randomStart;
              if (Array.isArray(script.randomStart))
                randomStart = script.randomStart[i];
              else
                randomStart = script.randomStart;

              if (randomStart.range) {
                let range = randomStart.range;
                let start = Math.floor(range[0] + Math.random() * range[1]);

                let layer = null;
                FRAME:for (let frameId = 0; frameId < sprite.frames.length; frameId++) {
                  let thisFrame = sprite.frames[frameId];
                  if (!thisFrame.layers) continue;

                  for (let layerId = 0; layerId < thisFrame.layers.length; layerId++) {
                    let thisLayer = thisFrame.layers[layerId];
                    if (thisLayer.name === layerName) {
                      layer = thisLayer;
                      break FRAME;
                    }
                  }
                }

                if (layer === null)
                  throw 'Layer not found';

                layer.startFrameId = start;
              }
              else
                throw 'Unsupported random start';
            }

            // Randomize the parent sprite starting frameId for sub sprite
            if (script.randomOffset) {
              let randomOffset;
              if (Array.isArray(script.randomOffset))
                randomOffset = script.randomOffset[i];
              else
                randomOffset = script.randomOffset;

              if (randomOffset.range) {
                let range = randomOffset.range;
                let offsetFrameId = Math.floor(range[0] + Math.random() * range[1]);

                let rollingLayers = [];
                let rollingDepth;
                for (let frameId = 0; frameId < sprite.frames.length; frameId++) {
                  let frame = sprite.frames[frameId];

                  if (rollingDepth === undefined) {
                    let layerId = frame.layers.findIndex(l => l.name === layerName);
                    if (layerId > -1) {
                      rollingLayers.push(frame.layers.splice(layerId, 1)[0]);
                      rollingDepth = rollingLayers[0].depth;
                    }
                  }
                  else {
                    let layerId = frame.layers.findIndex(l => l.depth === rollingDepth);
                    if (layerId > -1)
                      rollingLayers.push(frame.layers.splice(layerId, 1)[0]);
                    else
                      rollingLayers.push(null);
                  }

                  if (rollingLayers.length && frameId >= offsetFrameId) {
                    let layer = rollingLayers.shift();
                    if (layer) {
                      frame.layers.push(layer);
                      frame.layers.sort((a,b) => b.depth - a.depth);
                    }
                  }
                }

                if (rollingDepth === undefined)
                  throw 'Start frame not found';
              }
              else
                throw 'Unsupported random start';
            }
          }
        }
        else if (script.name === 'offsetX' || script.name === 'offsetY') {
          let frameIds = script.frameId;
          if (!Array.isArray(frameIds))
            frameIds = [frameIds];

          let offset = Math.random();
          let randomOffset = script.randomOffset;

          if (randomOffset) {
            if (randomOffset.multiplier)
              offset *= randomOffset.multiplier;
            if (randomOffset.offset)
              offset += randomOffset.offset;
          }

          for (let i = 0; i < frameIds.length; i++) {
            let frameId = frameIds[i];
            let prevFrameTransform = frameId > 0 && sprite.frames[frameId-1].transform || [1,0,0,1,0,0];
            let frame = sprite.frames[frameId];

            if (!frame.transform)
              frame.transform = [1,0,0,1,0,0];

            if (script.name === 'offsetX')
              frame.transform[4] += prevFrameTransform[4] + offset;
            else
              frame.transform[5] += prevFrameTransform[5] + offset;
          }
        }
      });
    }

    /*
     * Assign frame IDs to sprite layers
     */
    for (let frameId = 0; frameId < sprite.frames.length; frameId++) {
      let frame = sprite.frames[frameId];
      if (!frame.layers)
        continue;

      let lastLayers = frameId ? sprite.frames[frameId-1].layers || [] : [];
      for (let layerId = frame.layers.length-1; layerId > -1; layerId--) {
        let layer = frame.layers[layerId];
        if (layer.type !== 'sprite') continue;

        let subSprite;
        if (typeof layer.spriteId === 'number')
          subSprite = data.sprites[layer.spriteId];
        else
          subSprite = AnimatedSprite.get(layer.spriteId);

        let lastLayer = lastLayers.find(l => l.depth === layer.depth);
        if (lastLayer && lastLayer.spriteId === layer.spriteId) {
          layer.startFrameId = lastLayer.startFrameId;
          layer.offsetFrameId = lastLayer.offsetFrameId;
          layer.frameId = lastLayer.frameId + 1;
        }
        else {
          if (!layer.startFrameId)
            layer.startFrameId = 0;
          layer.offsetFrameId = frameId;
          layer.frameId = 0;
        }

        if (layer.frameId === subSprite.frames.length) {
          if (subSprite.loop)
            layer.frameId = 0;
          else
            // Sprite finished playing, so remove from following frames
            for (let fId = frameId; fId < sprite.frames.length; fId++) {
              let frm = sprite.frames[fId];
              if (!frm.layers)
                break;

              let lId = frm.layers.findIndex(l => l.depth === layer.depth);
              if (lId === -1)
                break;

              let lyr = frm.layers[lId];
              if (lyr.type !== 'sprite' || lyr.spriteId !== layer.spriteId)
                break;

              frm.layers.splice(lId, 1);
            }
        }
      }
    }

    /*
     * Add frames, if needed, to allow sub sprites to finish.
     */
    while (true) {
      let lastFrame = sprite.frames.last;
      let layers = [];

      if (lastFrame.layers)
        for (let i = 0; i < lastFrame.layers.length; i++) {
          let layer = lastFrame.layers[i];
          if (layer.type !== 'sprite')
            continue;
          if (layer.frameId === undefined)
            continue;

          let subSprite;
          if (typeof layer.spriteId === 'number')
            subSprite = data.sprites[layer.spriteId];
          else
            subSprite = AnimatedSprite.get(layer.spriteId);
          if (subSprite.loop)// && sprite.frames.length >= subSprite.frames.length)
            continue;
          if (layer.frameId === subSprite.frames.length-1)
            continue;

          layers.push(Object.assign({}, layer, {
            frameId: layer.frameId + 1,
          }));
        }

      if (!layers.length)
        break;

      sprite.frames.push({ id:sprite.frames.length, layers });
    }

    return sprite;
  }
  _compileSounds(data, sounds) {
    return sounds.map(sound => {
      if (typeof sound === 'number')
        sound = { soundId:sound };

      let howl = data.sounds[sound.soundId].howl;
      let spriteName;

      if (sound.clip) {
        spriteName = sound.clip.join(':');
        howl._sprite[spriteName] = sound.clip;
      }

      let volumeScale = howl.volume();
      let volume = 'volume' in sound ? sound.volume : volumeScale;
      let fadeStops = [];
      if (Array.isArray(volume)) {
        if (typeof sound.volume[0] === 'number')
          volume = sound.volume.shift() * volumeScale;
        else
          volume = volumeScale;

        let offset = 0;
        for (let i = 0; i < sound.volume.length; i++) {
          let fadeFrom = i === 0 ? volume : sound.volume[i-1][0] * volumeScale;
          let fadeTo = sound.volume[i][0] * volumeScale;
          let fadeOver = sound.volume[i][1] - offset;

          if (fadeFrom !== fadeTo)
            fadeStops.push([fadeFrom, fadeTo, fadeOver, offset]);

          offset += fadeOver;
        }

        // Don't set volume if the first fade stop starts at offset 0
        if (fadeStops.length && fadeStops[0][3] === 0)
          volume = volumeScale;
      }

      let scriptBody = [];

      if (sound.noConflict)
        scriptBody.push('if (howl.playing()) return;');

      if (volume !== volumeScale || fadeStops.length)
        scriptBody.push('let playId = ');

      if (spriteName)
        scriptBody.push(`howl.play('${spriteName}');`);
      else
        scriptBody.push('howl.play();');

      if (volume !== volumeScale)
        scriptBody.push(`howl.volume(${volume}, playId);`);

      fadeStops.forEach(stop => {
        let fade = `howl.fade(${stop[0]}, ${stop[1]}, ${stop[2]}, playId)`;

        if (stop[3] === 0)
          scriptBody.push(`${fade};`);
        else
          scriptBody.push(`setTimeout(() => ${fade}, ${stop[3]});`);
      });

      return new Function('howl', scriptBody.join('')).bind(null, howl);
    });
  }

  _renderFrame(sprites, name, frames, frameId, options) {
    let frameIndex = frameId % frames.length;
    let scripts = [];
    let container = new PIXI.Container();
    container.label = name;

    let frameData = frames[frameIndex];
    if (options.styles && options.styles[name]) {
      let style = options.styles[name];
      normalizeTransform(style);
      normalizeColor(style);

      frameData = Object.assign({}, frameData, style, {
        transform: mergeTransforms(frameData.transform, style.transform),
        color: mergeColors(frameData.color, style.color),
      });
    }

    if (options.unit) {
      let unit = options.unit;
      let prevFrameData = frameId > 0 ? frames[(frameId - 1) % frames.length] : {};

      // Apply unit styles
      if (frameData.unit)
        scripts.push(() => {
          let container = unit.getContainerByName('unit');
          applyTransform(container, frameData.unit.transform);
          applyColor(container, frameData.unit.color);
          applyEffects(container, frameData.unit.effects);
        });
      // Clear previously applied unit styles
      else if (prevFrameData.unit)
        scripts.push(() => {
          let container = unit.getContainerByName('unit');
          applyTransform(container);
          applyColor(container);
          applyEffects(container);
        });
    }

    if (frameData.sounds && !options.silent)
      scripts.push(...frameData.sounds);

    if (frameData.layers) {
      frameData.layers.forEach(layerData => {
        let layer;

        if (options.styles && options.styles[layerData.name]) {
          let style = options.styles[layerData.name];
          normalizeTransform(style);
          normalizeColor(style);

          layerData = Object.assign({}, layerData, style, {
            transform: mergeTransforms(layerData.transform, style.transform),
            color: mergeColors(layerData.color, style.color),
          });
        }

        if (layerData.type === 'sprite') {
          let spriteFrame;
          let subFrameId = layerData.startFrameId + (frameId - layerData.offsetFrameId);
          let subFrameData;
          if (typeof layerData.spriteId === 'number') {
            let subSprite = sprites[layerData.spriteId];
            let subFrameIndex = subFrameId % subSprite.frames.length;
            subFrameData = subSprite.frames[subFrameIndex];
            spriteFrame = this._renderFrame(
              sprites,
              subSprite.name,
              subSprite.frames,
              subFrameId,
              options,
            );
          } else {
            let importSpriteName = layerData.spriteId.replace(/\/.+$/, '');
            let importSprite = AnimatedSprite.get(importSpriteName);
            let subSprite = AnimatedSprite.get(layerData.spriteId);
            let subFrameIndex = subFrameId % subSprite.frames.length;
            subFrameData = subSprite.frames[subFrameIndex];
            spriteFrame = importSprite._renderFrame(
              importSprite.sprites,
              subSprite.name,
              subSprite.frames,
              subFrameId,
              options,
            );
          }

          scripts.push(...spriteFrame.scripts);
          layer = spriteFrame.container;
          let style = options.styles[layer.label];

          if (layerData.transform)
            applyTransform(layer, mergeTransforms(subFrameData.transform, layerData.transform));
          if (layerData.color && !style?.color)
            applyColor(layer, mergeColors(subFrameData.color, layerData.color));
          if (layerData.effects)
            applyEffects(layer, layerData.effects);
        } else if (layerData.type === 'image') {
          layer = PIXI.Sprite.from(this._data.images[layerData.imageId].texture);

          if (layerData.name !== undefined)
            layer.label = layerData.name;
          if (layerData.transform)
            applyTransform(layer, layerData.transform);
          if (layerData.color)
            applyColor(layer, layerData.color);
          if (layerData.effects)
            applyEffects(layer, layerData.effects);
        } else if (layerData.type === 'button') {
          let button = this._data.buttons[layerData.buttonId];
          let buttonUpFrame = this._renderFrame(
            sprites,
            null,
            [button.up],
            0,
            options,
          );
          let buttonOverFrame = this._renderFrame(
            sprites,
            null,
            [button.over],
            0,
            options,
          );
          buttonOverFrame.container.alpha = 0;
          let buttonDownFrame = this._renderFrame(
            sprites,
            null,
            [button.down],
            0,
            options,
          );

          scripts.push(...buttonUpFrame.scripts);
          layer = new PIXI.Container();
          layer.label = layerData.name;
          /*
           * Adding both states to the container since swapping children or even
           * visibility can cause the over/out events to rapidly alternate.
           * Changing alpha, however, does not exhibit this behavior.
           */
          layer.addChild(buttonUpFrame.container);
          layer.addChild(buttonOverFrame.container);

          if (options.onButtonEvent) {
            layer.interactive = true;
            layer.cursor = 'pointer';
            layer.on('pointertap', () => {
              buttonDownFrame.scripts.forEach(s => s());

              options.onButtonEvent({
                type: 'select',
                name: layerData.name,
              });
            });
            layer.on('pointerover', () => {
              buttonUpFrame.container.alpha = 0;
              buttonOverFrame.container.alpha = 1;

              buttonOverFrame.scripts.forEach(s => s());

              options.onButtonEvent({
                type: 'focus',
                name: layerData.name,
              });
            });
            layer.on('pointerout', () => {
              buttonUpFrame.container.alpha = 1;
              buttonOverFrame.container.alpha = 0;

              options.onButtonEvent({
                type: 'blur',
                name: layerData.name,
              });
            });
          }

          if (layerData.transform)
            applyTransform(layer, layerData.transform);
          if (layerData.color)
            applyColor(layer, layerData.color);
          if (layerData.effects)
            applyEffects(layer, layerData.effects);
        } else
          throw `Unsupported layer type: ${layerData.type}`;

        if (layerData.visible !== undefined)
          layer.visible = !!layerData.visible;

        container.addChild(layer);
      });
    }

    if (frameData.transform)
      applyTransform(container, frameData.transform);
    if (frameData.color)
      applyColor(container, frameData.color);
    if (frameData.effects)
      applyEffects(layer, frameData.effects);

    return { container, scripts };
  }
};

emitter(AnimatedSprite);

/*
 * A number of properties can describe transform components.
 * Convert them into a matrix.
 */
function normalizeTransform(data, fromTransform = [1,0,0,1,0,0]) {
  data.transform = data.transform || fromTransform.slice();

  if (data.scale !== undefined) {
    if (Array.isArray(data.scale)) {
      data.transform[0] = data.scale[0];
      data.transform[3] = data.scale[1];
    }
    else
      data.transform[0] = data.transform[3] = data.scale;
    delete data.scale;
  }
  if (data.skew !== undefined) {
    if (Array.isArray(data.skew))
      data.transform.splice(1, 2, ...data.skew);
    else
      data.transform.splice(1, 2, data.skew, data.skew);
    delete data.skew;
  }
  if (data.position !== undefined) {
    if (Array.isArray(data.position))
      data.transform.splice(4, 2, ...data.position);
    else
      data.transform.splice(4, 2, data.position, data.position);
    delete data.position;
  }

  if (data.transform.join(',') === '1,0,0,1,0,0')
    delete data.transform;
}
function mergeTransforms(...matrices) {
  matrices = matrices.filter(m => !!m);
  if (matrices.length === 0)
    return;
  else if (matrices.length === 1)
    return matrices[0];

  let r = matrices.shift().slice();

  for (let i = 0; i < matrices.length; i++) {
    let m = matrices[i];
    let sx = 0; // Horizontal Scale
    let rx = 1; // Horizontal Rotate/Skew
    let ry = 2; // Vertical Rotate/Skew
    let sy = 3; // Vertical Scale
    let tx = 4; // Horizontal Translation
    let ty = 5; // Vertical Translation

    r = [
      m[sx] * r[sx] + m[ry] * r[rx],
      m[rx] * r[sx] + m[sy] * r[rx],
      m[sx] * r[ry] + m[ry] * r[sy],
      m[rx] * r[ry] + m[sy] * r[sy],
      m[sx] * r[tx] + m[ry] * r[ty] + m[tx],
      m[rx] * r[tx] + m[sy] * r[ty] + m[ty],
    ];
  }

  return r;
}
function applyTransform(container, transform = [1,0,0,1,0,0]) {
  container.setFromMatrix(new PIXI.Matrix(
    transform[0], // scaleX
    transform[2], // skewY
    transform[1], // skewX
    transform[3], // scaleY
    transform[4], // x
    transform[5], // y
  ));
}

function normalizeColor(data, fromColor) {
  if (
    data.color !== undefined ||
    data.rgba ||
    data.rgb !== undefined ||
    data.alpha !== undefined
  ) {
    let color = fromColor ? fromColor.slice() : [0,0,0,0,1,1,1,1];

    if (Array.isArray(data.color)) {
      if (typeof data.color === 'number')
        color.splice(0, 3,
          (data.color & 0xFF0000) / 0x010000,
          (data.color & 0x00FF00) / 0x000100,
          (data.color & 0x0000FF) / 0x000001,
        );
      else // expected length: 3 or 4
        color.splice(0, data.color.length, ...data.color);
    }

    if (data.rgba) {
      color.splice(4, 4, ...data.rgba);
      delete data.rgba;
    }

    if (data.rgb) {
      if (typeof data.rgb === 'number')
        color.splice(4, 3,
          (data.rgb & 0xFF0000) / 0xFF0000,
          (data.rgb & 0x00FF00) / 0x00FF00,
          (data.rgb & 0x0000FF) / 0x0000FF,
        );
      else
        color.splice(4, 3, ...data.rgb);
      delete data.rgb;
    }

    if (data.alpha !== undefined) {
      color.splice(7, 1, data.alpha);
      delete data.alpha;
    }

    data.color = color;
  }
  else if (fromColor)
    data.color = fromColor.slice();
}
function mergeColors(...colorMatrices) {
  colorMatrices = colorMatrices.filter(m => !!m);
  if (colorMatrices.length === 0)
    return;
  else if (colorMatrices.length === 1)
    return colorMatrices[0];

  let r = colorMatrices.shift().slice();

  for (let i = 0; i < colorMatrices.length; i++) {
    let t = colorMatrices[i];
    let ar = 0;
    let ag = 1;
    let ab = 2;
    let aa = 3;
    let mr = 4;
    let mg = 5;
    let mb = 6;
    let ma = 7;

    r = [
      r[ar] + t[ar], r[ag] + t[ag], r[ab] + t[ab], r[aa] + t[aa],
      r[mr] * t[mr], r[mg] * t[mg], r[mb] * t[mb], r[ma] * t[ma],
    ];
  }

  return r;
}
function setFilter(container, name, seq, filter) {
  filter.name = name;
  filter.seq = seq;

  const filters = container.filters ? container.filters.slice() : [];

  let index = filters.findIndex(f => f.name === name);
  if (index > -1)
    filters[index] = filter;
  else {
    filters.push(filter);
    filters.sort((a, b) => a.seq - b.seq);
  }

  container.filters = filters;
}
function clearFilter(displayObject, name) {
  if (!displayObject.filters) return;
  const index = displayObject.filters.findIndex(f => f.name === name);
  if (index === -1) return;

  if (displayObject.filters.length === 1)
    displayObject.filters = null;
  else
    displayObject.filters = displayObject.filters.filter(f => f.name !== name);
}
function applyColor(displayObject, color) {
  if (color && color.join() !== '0,0,0,0,1,1,1,1') {
    let filter = new PIXI.filters.ColorMatrixFilter();
    filter.matrix[4]  = Math.min(255, color[0]) / 255;
    filter.matrix[9]  = Math.min(255, color[1]) / 255;
    filter.matrix[14] = Math.min(255, color[2]) / 255;
    filter.matrix[19] = Math.min(255, color[3]) / 255;
    filter.matrix[0]  = color[4];
    filter.matrix[6]  = color[5];
    filter.matrix[12] = color[6];
    filter.matrix[18] = color[7];

    setFilter(displayObject, 'color', 0, filter);
  } else
    clearFilter(displayObject, 'color');
}
function applyEffects(displayObject, effects) {
  if (effects && Object.keys(effects).length > 0) {
    let filter = new PIXI.filters.ColorMatrixFilter();

    for (let effect of effects) {
      if (effect.args)
        filter[effect.method](...effect.args);
      else
        filter[effect.method]();
    }

    setFilter(displayObject, 'effects', 1, filter);
  } else
    clearFilter(displayObject, 'effects');
}

// Static property
AnimatedSprite.spriteMap = new Map();
