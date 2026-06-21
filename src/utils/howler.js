/**
 * howl.js
 * --------------------------------------------------------------------------
 * A small ES6 module that loosely imitates the Howler.js API surface but is
 * implemented exclusively on top of the Web Audio API (no <audio> elements,
 * no HTML5 audio fallback mode). Written as a drop-in-ish replacement for
 * projects moving off the unmaintained Howler.js library.
 *
 * WHY WEB AUDIO ONLY
 *   HTMLAudioElement playback has noticeable, inconsistent start-up latency
 *   on mobile (especially Android Chrome/WebView and iOS Safari), because
 *   each .play() call has to spin up an OS-level media session. Web Audio's
 *   AudioBufferSourceNode has none of that overhead once the audio is
 *   decoded: scheduling a sound is just connecting a couple of nodes and
 *   calling .start(), which is effectively instantaneous.
 *
 * MINIMIZING MOBILE PLAYBACK DELAY
 *   The classic causes of "delayed sound" on mobile are:
 *     1. Decoding audio on-demand, in response to the triggering event,
 *        instead of ahead of time.
 *     2. Creating/resuming the AudioContext lazily, at the moment a sound
 *        is needed, instead of as early as possible.
 *     3. Using <audio> elements, which carry their own OS media-session
 *        start-up cost.
 *     4. Not "fully" waking the audio hardware output path on iOS Safari,
 *        which historically requires playing an actual (silent) buffer
 *        from inside a genuine user gesture, not just resuming the
 *        AudioContext state.
 *   This module addresses all four: sources are decoded into AudioBuffers
 *   as soon as a Howl is constructed (well before any interaction), a
 *   single shared AudioContext is created on first use, and the unlock
 *   routine both resumes the context AND plays a one-sample silent buffer
 *   synchronously inside the gesture handler.
 *
 * CROSS-BROWSER NOTES
 *   - Chrome / Opera / Android Chrome / Samsung Internet: Blink-based,
 *     standard Web Audio support, autoplay policy requires a gesture to
 *     resume a suspended AudioContext (handled by the unlock routine).
 *   - Firefox / Firefox for Android: standard Web Audio support.
 *   - Safari / iOS Safari / Mac: historically the strictest. Needs the
 *     gesture-synchronous silent-buffer trick to fully unlock audio output,
 *     not just context.resume(). The legacy `webkitAudioContext` prefix is
 *     also checked for older WebKit builds, and decodeAudioData falls back
 *     to its legacy callback signature if the Promise form isn't honored.
 *
 * WHAT IS *NOT* IMPLEMENTED (vs. real Howler.js)
 *   - HTML5 audio / streaming mode (`html5: true`) — intentionally omitted,
 *     since avoiding <audio> elements is the whole point here.
 *   - Stereo panning / 3D spatial audio.
 *   - Non-linear fade curves (fades are linear ramps).
 *   - Codec sniffing via Audio().canPlayType() — decodeAudioData inspects
 *     the actual file header, so this isn't needed; multiple `src` entries
 *     are still tried in order if one fails to decode.
 *   - A general-purpose .on()/.off() event emitter — only the constructor
 *     callbacks used by your existing code (onload, onloaderror,
 *     onplayerror, onend) are supported. Easy to extend if you need more.
 *
 * COMPATIBILITY WITH EXISTING CODE
 *   Your AnimatedSprite.js reaches directly into two "private" Howler
 *   properties:
 *     - howl._src     -> exposed here as a plain array, same as Howler.
 *     - howl._sprite  -> exposed here as a plain mutable object, same as
 *                        Howler, so `howl._sprite[name] = clip` keeps working.
 *   The onloaderror callback also fires with the exact string
 *   'Decoding audio data failed.' for decode failures, matching the literal
 *   string your code currently checks for.
 *
 * BASIC USAGE
 *   import { Howl, Howler } from 'utils/howl.js';
 *
 *   const sound = new Howl({
 *     src: ['explosion.mp3'],
 *     volume: 0.8,
 *     sprite: { boom: [0, 1200] },
 *     onload: () => console.log('ready'),
 *   });
 *
 *   // Safe to call at any time, even before the user has interacted.
 *   // If called before the page is "unlocked", playback is queued and
 *   // will fire automatically the moment the first gesture unlocks audio.
 *   const id = sound.play('boom');
 *   sound.fade(1, 0, 500, id);
 *
 *   // Recommended: wire an explicit "tap to start" control to guarantee
 *   // the earliest possible, most reliable unlock on iOS:
 *   //   startButton.addEventListener('click', () => Howler.unlock());
 * --------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Shared AudioContext, master gain, and the gesture-unlock state machine.
// A single AudioContext is reused by every Howl instance, mirroring
// Howler's own approach and avoiding the low ceiling some mobile browsers
// place on the number of concurrent AudioContexts.
// ---------------------------------------------------------------------------

const AudioContextClass =
  typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);

let _ctx = null;
let _masterGain = null;
let _unlocked = false;
let _unlockQueue = [];
let _unlockListenersBound = false;
let _unlockPromise = null;
let _resolveUnlockPromise = null;

// Cover both touch and pointer/mouse/keyboard gestures so unlocking works
// consistently across mobile and desktop browsers, including Opera and
// Firefox derivatives that don't fire all the same event types.
const UNLOCK_EVENTS = ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'keydown'];

function ensureContext() {
  if (_ctx) return _ctx;
  if (!AudioContextClass) {
    console.warn('[howl.js] The Web Audio API is not supported in this browser.');
    return null;
  }

  try {
    _ctx = new AudioContextClass({ latencyHint: 'interactive' });
  } catch (e) {
    // Some older engines don't accept a constructor options dictionary.
    _ctx = new AudioContextClass();
  }

  // Safari (16.4+) treats Web Audio as "ambient" by default, meaning it's
  // silenced by the iOS hardware mute/ringer switch regardless of whether
  // the AudioContext is unlocked and running. Opting into the "playback"
  // audio session category makes it behave like real media playback and
  // ignore that switch. Safari-only API; harmless no-op everywhere else.
  if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
    try {
      navigator.audioSession.type = 'playback';
    } catch (e) {
      // Non-fatal — worst case Safari keeps treating audio as ambient.
    }
  }

  _masterGain = _ctx.createGain();
  _masterGain.connect(_ctx.destination);

  bindUnlockListeners();
  bindVisibilityRecovery();

  return _ctx;
}

function attemptUnlock() {
  if (!_ctx) return;

  // Always attempt to resume, not just on the very first call. Chrome on
  // Android in particular will silently auto-suspend an idle AudioContext
  // to save power, with no event of its own warning you it happened — the
  // first you'd otherwise know is a noticeably delayed sound the next time
  // someone taps the screen. Re-checking on every gesture closes that gap
  // by starting the resume as early as possible, in parallel with whatever
  // else that interaction triggers.
  if (_ctx.state === 'suspended') {
    _ctx.resume().then(maybeFinishUnlock, maybeFinishUnlock);
  } else {
    maybeFinishUnlock();
  }

  // The silent-buffer trick is cheap; replaying it on every gesture (not
  // just the first) also helps keep iOS Safari's audio hardware path warm,
  // not only at the very start of the page's lifetime.
  try {
    const silentBuffer = _ctx.createBuffer(1, 1, _ctx.sampleRate);
    const silentSource = _ctx.createBufferSource();
    silentSource.buffer = silentBuffer;
    silentSource.connect(_ctx.destination);
    if (silentSource.start) silentSource.start(0);
    else if (silentSource.noteOn) silentSource.noteOn(0); // ancient WebKit
  } catch (e) {
    // Non-fatal; the resume() call above is the part that matters most.
  }
}

// One-time bookkeeping for the very first successful unlock: flips the
// `unlocked` flag, resolves `Howler.whenUnlocked`, and flushes any play()
// calls that were queued while audio was still locked. A no-op on every
// call after the first — attemptUnlock() itself keeps running on every
// gesture for the lifetime of the page, see above.
function maybeFinishUnlock() {
  if (_unlocked || !_ctx || _ctx.state !== 'running') return;

  _unlocked = true;

  if (_resolveUnlockPromise) {
    _resolveUnlockPromise(true);
    _resolveUnlockPromise = null;
  }

  const queued = _unlockQueue;
  _unlockQueue = [];
  queued.forEach((fn) => fn());
}

// A memoized promise that resolves (with `true`) the moment audio becomes
// unlocked — already-resolved if it's unlocked already. Exposed publicly
// as `Howler.whenUnlocked`, this is the cleanest way to gate UI on audio
// readiness without writing your own gesture-detection/statechange code.
function getUnlockPromise() {
  if (_unlockPromise) return _unlockPromise;

  if (_unlocked) {
    _unlockPromise = Promise.resolve(true);
  } else {
    _unlockPromise = new Promise((resolve) => {
      _resolveUnlockPromise = resolve;
    });
  }

  return _unlockPromise;
}

function bindUnlockListeners() {
  if (_unlockListenersBound || typeof document === 'undefined') return;
  _unlockListenersBound = true;

  UNLOCK_EVENTS.forEach((evt) => {
    document.addEventListener(evt, attemptUnlock, { passive: true });
  });
}

// iOS in particular can drop the AudioContext back to 'suspended' when the
// tab is backgrounded (app switch, screen lock, phone call). Re-resume it
// automatically once the page is visible again, without waiting for a
// brand new gesture to be detected as an "unlock" event.
function bindVisibilityRecovery() {
  if (typeof document === 'undefined') return;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _ctx && _ctx.state === 'suspended' && _unlocked) {
      _ctx.resume().catch(() => {});
    }
  });
}

function queueOrRun(fn) {
  if (_unlocked) fn();
  else _unlockQueue.push(fn);
}

// ---------------------------------------------------------------------------
// Source loading helpers
// ---------------------------------------------------------------------------

function fetchAsArrayBuffer(src) {
  // Data URIs are decoded by hand rather than via fetch(): it avoids a
  // network round-trip entirely (faster), and sidesteps strict
  // Content-Security-Policy connect-src rules that some sites apply even
  // to data: URIs.
  if (typeof src === 'string' && src.startsWith('data:')) {
    return Promise.resolve(dataURIToArrayBuffer(src));
  }

  return fetch(src).then((response) => {
    if (!response.ok) throw new Error(`Failed to fetch audio source: ${src}`);
    return response.arrayBuffer();
  });
}

function dataURIToArrayBuffer(dataURI) {
  const base64 = dataURI.substring(dataURI.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function decodeAudioDataCompat(ctx, arrayBuffer) {
  // Modern engines support the Promise-returning form of decodeAudioData.
  // A handful of older WebKit builds only implement the legacy
  // (successCallback, errorCallback) form. Passing both at once and
  // resolving/rejecting from whichever fires first is a standard,
  // harmless compatibility shim (the spec keeps both signatures live).
  return new Promise((resolve, reject) => {
    const maybePromise = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then(resolve, reject);
    }
  });
}

// ---------------------------------------------------------------------------
// Howl
// ---------------------------------------------------------------------------

let _idCounter = 0;

export class Howl {
  /**
   * @param {object} options
   * @param {string|string[]} options.src - One or more source URLs/data URIs,
   *   tried in order until one decodes successfully.
   * @param {string} [options.format] - Accepted for API compatibility; not
   *   used internally since decodeAudioData identifies the codec from the
   *   file itself rather than the URL.
   * @param {number} [options.volume=1]
   * @param {number} [options.rate=1]
   * @param {boolean} [options.loop=false]
   * @param {boolean} [options.preload=true]
   * @param {object} [options.sprite] - { name: [offsetMs, durationMs, loop?] }
   * @param {function} [options.onload]
   * @param {function} [options.onloaderror] - (id, message)
   * @param {function} [options.onplayerror] - (id, message)
   * @param {function} [options.onend] - (id)
   */
  constructor(options = {}) {
    this._src = Array.isArray(options.src) ? options.src.slice() : [options.src];
    this._format = options.format;
    this._sprite = options.sprite || {};
    this._volume = options.volume !== undefined ? options.volume : 1;
    this._rate = options.rate !== undefined ? options.rate : 1;
    this._loop = !!options.loop;

    this._listeners = new Map();
    if (options.onload) this.on('load', options.onload);
    if (options.onloaderror) this.on('loaderror', options.onloaderror);
    if (options.onplayerror) this.on('playerror', options.onplayerror);
    if (options.onend) this.on('end', options.onend);

    this._buffer = null;
    this._loaded = false;
    this._loading = false;
    this._loadFailed = false;
    this._sounds = new Map();

    this._ctx = ensureContext();
    this._gainNode = this._ctx ? this._ctx.createGain() : null;
    if (this._gainNode) {
      this._gainNode.gain.value = this._volume;
      this._gainNode.connect(_masterGain);
    }

    if (options.preload !== false) this.load();
  }

  /**
   * Register a listener for 'load', 'loaderror', 'play', 'playerror', or
   * 'end'. Mirrors Howler's on()/once()/off() event API.
   */
  on(event, callback) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(callback);
    return this;
  }

  /** Remove a specific listener, or every listener for an event if omitted. */
  off(event, callback) {
    if (this._listeners.has(event)) {
      if (callback) this._listeners.get(event).delete(callback);
      else this._listeners.delete(event);
    }
    return this;
  }

  /** Register a listener that automatically removes itself after firing once. */
  once(event, callback) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      callback(...args);
    };
    return this.on(event, wrapper);
  }

  _emit(event, ...args) {
    const listeners = this._listeners.get(event);
    if (!listeners) return;
    // Snapshot first: a listener (e.g. once()) may mutate the set while
    // we're iterating over it.
    for (const callback of Array.from(listeners)) {
      try {
        callback(...args);
      } catch (e) {
        console.error(e);
      }
    }
  }

  /**
   * Fetch and decode the source audio. Safe to call well before any user
   * interaction — decoding does not require an unlocked AudioContext, only
   * playback does.
   */
  load() {
    if (this._loaded || this._loading) return this;

    if (!this._ctx) {
      this._fail('Web Audio API is not supported.');
      return this;
    }

    this._loading = true;
    this._decodeFirstWorkingSource(0);
    return this;
  }

  async _decodeFirstWorkingSource(index) {
    if (index >= this._src.length) {
      this._loading = false;
      this._fail('Decoding audio data failed.');
      return;
    }

    try {
      const arrayBuffer = await fetchAsArrayBuffer(this._src[index]);
      const audioBuffer = await decodeAudioDataCompat(this._ctx, arrayBuffer);

      this._buffer = audioBuffer;
      this._loaded = true;
      this._loading = false;

      this._emit('load');
    } catch (err) {
      this._decodeFirstWorkingSource(index + 1);
    }
  }

  _fail(message) {
    this._loadFailed = true;
    this._emit('loaderror', 0, message);
  }

  /**
   * Play the whole sound, or a named sprite clip. Returns a sound id that
   * can be passed to volume(), rate(), fade(), pause(), stop(), playing().
   * If called before the page's first user gesture has unlocked audio,
   * the request is queued and starts automatically as soon as it unlocks.
   * @param {string|number} [spriteOrId] - sprite name to play, or an
   *   existing paused sound id to resume.
   * @returns {number|null}
   */
  play(spriteOrId) {
    if (!this._ctx) return null;

    if (typeof spriteOrId === 'number' && this._sounds.has(spriteOrId)) {
      return this._resume(spriteOrId);
    }

    const spriteName = typeof spriteOrId === 'string' ? spriteOrId : '__default';
    const id = ++_idCounter;

    // Created up front, not in _startSound(), so that volume()/fade() work
    // correctly even if called immediately after play() returns — a very
    // common chaining idiom (e.g. `howl.fade(0, 1, 500, howl.play())`) —
    // while the actual AudioBufferSourceNode is still waiting on decode
    // and/or the page's audio-unlock gesture.
    const gainNode = this._ctx.createGain();
    gainNode.gain.value = 1;
    gainNode.connect(this._gainNode);

    const sound = {
      id,
      spriteName,
      sourceNode: null,
      gainNode,
      rate: this._rate,
      startedAt: 0,
      offset: 0,
      paused: false,
      stopped: false,
    };
    this._sounds.set(id, sound);

    queueOrRun(() => this._startSound(sound));

    return id;
  }

  _startSound(sound) {
    if (sound.stopped) return;

    if (!this._loaded) {
      if (this._loadFailed) {
        this._emit('playerror', sound.id, 'Cannot play: source failed to load.');
        if (sound.gainNode) sound.gainNode.disconnect();
        this._sounds.delete(sound.id);
        return;
      }
      // Rare race: play() was called while preload decoding was still in
      // flight. Retry briefly rather than dropping the request.
      setTimeout(() => this._startSound(sound), 20);
      return;
    }

    let offsetSec = 0;
    let durationSec = this._buffer.duration;
    let loop = this._loop;

    if (sound.spriteName !== '__default') {
      const clip = this._sprite[sound.spriteName];
      if (!clip) {
        this._emit('playerror', sound.id, `Sprite "${sound.spriteName}" not found.`);
        if (sound.gainNode) sound.gainNode.disconnect();
        this._sounds.delete(sound.id);
        return;
      }
      offsetSec = clip[0] / 1000;
      durationSec = clip[1] / 1000;
      loop = clip[2] !== undefined ? !!clip[2] : loop;
    }

    const ctx = this._ctx;

    // Belt-and-suspenders alongside the gesture listeners: if Chrome/Android
    // silently auto-suspended the context for power saving since the last
    // sound played, kick off the resume here too rather than relying solely
    // on the next gesture to catch it.
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const source = ctx.createBufferSource();
    source.buffer = this._buffer;
    source.playbackRate.value = sound.rate;

    // sound.gainNode already exists (created in play()) and is already
    // connected to this._gainNode — just wire the new source into it.
    source.connect(sound.gainNode);

    sound.sourceNode = source;
    sound.startedAt = ctx.currentTime;
    sound.spriteOffset = offsetSec;
    sound.spriteDuration = durationSec;

    source.onended = () => this._handleEnded(sound);

    const startOffset = offsetSec + (sound.offset || 0);

    if (loop) {
      source.loop = true;
      source.loopStart = offsetSec;
      source.loopEnd = offsetSec + durationSec;
      source.start(0, startOffset);
    } else {
      source.start(0, startOffset, Math.max(durationSec - (sound.offset || 0), 0));
    }

    this._emit('play', sound.id);
  }

  _handleEnded(sound) {
    if (sound.paused || sound.stopped) return;
    if (sound.gainNode) sound.gainNode.disconnect();
    this._sounds.delete(sound.id);
    this._emit('end', sound.id);
  }

  _resume(id) {
    const sound = this._sounds.get(id);
    if (!sound) return null;

    sound.paused = false;
    queueOrRun(() => this._startSound(sound));

    return id;
  }

  /** Pause playback, remembering position so play(id) resumes from there. */
  pause(id) {
    const sound = this._sounds.get(id);
    if (!sound || !sound.sourceNode) return this;

    const elapsed = (this._ctx.currentTime - sound.startedAt) * this._rate;
    sound.offset = (sound.offset || 0) + elapsed;
    sound.paused = true;

    try {
      sound.sourceNode.stop();
    } catch (e) {}
    sound.sourceNode = null;

    return this;
  }

  /** Stop and discard a sound (or all sounds, if id is omitted). */
  stop(id) {
    if (id === undefined) {
      Array.from(this._sounds.keys()).forEach((soundId) => this.stop(soundId));
      return this;
    }

    const sound = this._sounds.get(id);
    if (!sound) return this;

    sound.stopped = true;
    if (sound.sourceNode) {
      try {
        sound.sourceNode.stop();
      } catch (e) {}
    }
    if (sound.gainNode) sound.gainNode.disconnect();
    this._sounds.delete(id);

    return this;
  }

  /** Get or set volume, either for the whole Howl or one playing sound. */
  volume(vol, id) {
    if (vol === undefined) {
      if (id !== undefined) {
        const sound = this._sounds.get(id);
        return sound && sound.gainNode ? sound.gainNode.gain.value : this._volume;
      }
      return this._volume;
    }

    if (id !== undefined) {
      const sound = this._sounds.get(id);
      if (sound && sound.gainNode) sound.gainNode.gain.value = vol;
      return this;
    }

    this._volume = vol;
    if (this._gainNode) this._gainNode.gain.value = vol;
    return this;
  }

  /** Get or set playback rate, either for the whole Howl or one sound. */
  rate(rate, id) {
    if (rate === undefined) {
      if (id !== undefined) {
        const sound = this._sounds.get(id);
        if (!sound) return this._rate;
        // Reflects the live value once started, or the value that will be
        // applied once it does, if it's still waiting on decode/unlock.
        return sound.sourceNode ? sound.sourceNode.playbackRate.value : sound.rate;
      }
      return this._rate;
    }

    if (id !== undefined) {
      const sound = this._sounds.get(id);
      if (sound) {
        sound.rate = rate;
        if (sound.sourceNode) sound.sourceNode.playbackRate.value = rate;
      }
      return this;
    }

    this._rate = rate;
    this._sounds.forEach((sound) => {
      sound.rate = rate;
      if (sound.sourceNode) sound.sourceNode.playbackRate.value = rate;
    });
    return this;
  }

  /**
   * Linearly fade volume from -> to over duration (ms), for one sound id
   * or, if omitted, every currently playing sound on this Howl.
   */
  fade(from, to, duration, id) {
    if (!this._ctx) return this;

    const durationSec = duration / 1000;
    const targets = id !== undefined ? [this._sounds.get(id)] : Array.from(this._sounds.values());

    targets.forEach((sound) => {
      if (!sound || !sound.gainNode) return;
      const gain = sound.gainNode.gain;
      const now = this._ctx.currentTime;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(from, now);
      gain.linearRampToValueAtTime(to, now + durationSec);
    });

    return this;
  }

  /** Get or set looping, either for the whole Howl or one sound. */
  loop(loop, id) {
    if (loop === undefined) {
      if (id !== undefined) {
        const sound = this._sounds.get(id);
        return sound && sound.sourceNode ? sound.sourceNode.loop : this._loop;
      }
      return this._loop;
    }

    if (id !== undefined) {
      const sound = this._sounds.get(id);
      if (sound && sound.sourceNode) sound.sourceNode.loop = loop;
      return this;
    }

    this._loop = loop;
    return this;
  }

  /** Mute/unmute the whole Howl, or one playing sound. */
  mute(muted, id) {
    if (id !== undefined) {
      const sound = this._sounds.get(id);
      if (sound && sound.gainNode) sound.gainNode.gain.value = muted ? 0 : 1;
      return this;
    }

    if (this._gainNode) this._gainNode.gain.value = muted ? 0 : this._volume;
    return this;
  }

  /** Whether a specific sound id, or any sound on this Howl, is playing. */
  playing(id) {
    if (id !== undefined) {
      const sound = this._sounds.get(id);
      return !!(sound && sound.sourceNode && !sound.paused && !sound.stopped);
    }
    return Array.from(this._sounds.values()).some((s) => s.sourceNode && !s.paused && !s.stopped);
  }

  /** Whether the source has finished decoding and is ready to play. */
  state() {
    if (this._loadFailed) return 'error';
    return this._loaded ? 'loaded' : 'loading';
  }

  /** Stop everything and release references to the decoded buffer. */
  unload() {
    this.stop();
    if (this._gainNode) this._gainNode.disconnect();
    this._buffer = null;
    this._loaded = false;
    return this;
  }
}

// ---------------------------------------------------------------------------
// Howler — global controller, mirroring the real Howler.js singleton for
// master volume/mute and manual unlock control.
// ---------------------------------------------------------------------------

export const Howler = {
  get ctx() {
    return ensureContext();
  },

  get unlocked() {
    return _unlocked;
  },

  /**
   * A promise that resolves (with `true`) the moment audio playback
   * unlocks — already resolved if it's unlocked already. Useful for
   * gating UI on audio readiness, e.g.:
   *   state.whenAudioEnabled = Howler.whenUnlocked;
   *   if (await state.whenAudioEnabled) showLobby(); else showEnterLobby();
   */
  get whenUnlocked() {
    ensureContext();
    return getUnlockPromise();
  },

  /** Get or set the master (all-Howls) volume. */
  volume(vol) {
    ensureContext();
    if (!_masterGain) return 1;
    if (vol === undefined) return _masterGain.gain.value;
    _masterGain.gain.value = vol;
    return Howler;
  },

  /** Mute/unmute every Howl at once. */
  mute(muted) {
    ensureContext();
    if (_masterGain) _masterGain.gain.value = muted ? 0 : 1;
    return Howler;
  },

  /**
   * Manually attempt to unlock audio playback. Call this from inside a
   * known, deliberate user gesture (e.g. a "Tap to Start" button) for the
   * most reliable unlock on iOS Safari, in addition to (or instead of)
   * relying on the automatic document-level gesture listeners.
   */
  unlock() {
    ensureContext();
    attemptUnlock();
    return Howler;
  },
};

export default Howler;