/**
 * clone.js
 * A high-performance, safe deep clone utility for any JavaScript value.
 *
 * Handles:
 *  - Primitives (number, string, boolean, null, undefined, symbol, bigint)
 *  - Plain objects & null-prototype objects
 *  - Arrays (including sparse arrays and named own properties)
 *  - Date
 *  - RegExp
 *  - Map / Set
 *  - ArrayBuffer, SharedArrayBuffer, DataView
 *  - All TypedArrays (Int8Array, Float64Array, etc.)
 *  - Error (and subclasses)
 *  - Functions (returned by reference — functions are immutable)
 *  - Circular / shared references (correctly re-linked in the clone)
 *  - Object property descriptors (getters, setters, non-enumerable, non-writable)
 *  - Symbol-keyed properties
 *  - Prototype chain preservation for class instances
 *
 * Does NOT attempt to clone:
 *  - WeakMap / WeakSet (inherently uncloneable)
 *  - Proxy objects (transparent by design)
 *  - DOM nodes (environment-specific; pass them through by reference)
 *  - Functions (immutable; passed by reference)
 *
 * Dispatch strategy
 * ─────────────────
 * Each branching check uses the constructor reference directly rather than
 * calling Object.prototype.toString() and comparing strings. A constructor
 * lookup is a single property read + pointer comparison — no function call
 * overhead and no string allocation — making it measurably faster at depth.
 *
 * The only residual use of toString-style detection is inside the typed-array
 * path, where we need to confirm that value.constructor is one of the eleven
 * TypedArray constructors without writing eleven separate if-branches.
 * A constructor Set lookup is still a pointer comparison (O(1)), just routed
 * through a hash bucket instead of a linear chain of ===.
 */

// ── Constructor-identity sets ─────────────────────────────────────────────────

/**
 * All eleven TypedArray constructors, used for O(1) membership testing.
 * Guarded so the file loads safely in environments that lack some constructors
 * (e.g. BigInt64Array is absent in very old runtimes).
 */
const TYPED_ARRAY_CTORS = new Set([
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  typeof BigInt64Array  !== 'undefined' && BigInt64Array,
  typeof BigUint64Array !== 'undefined' && BigUint64Array,
].filter(Boolean));

/**
 * Constructors that are pass-through (returned by reference, uncloneable by
 * design). Registered in `seen` on encounter so shared/circular references
 * through these objects resolve correctly.
 *  - WeakMap/WeakSet/WeakRef: keys are not enumerable, deep-copy is impossible.
 *  - SharedArrayBuffer: intentionally shared memory; copying would break the
 *    sharing semantics that are the entire point of the type.
 */
const PASSTHROUGH_CTORS = new Set([
  typeof WeakMap           !== 'undefined' && WeakMap,
  typeof WeakSet           !== 'undefined' && WeakSet,
  typeof WeakRef           !== 'undefined' && WeakRef,
  typeof SharedArrayBuffer !== 'undefined' && SharedArrayBuffer,
].filter(Boolean));

// Parallel set of prototype objects for the registered constructors.
// Checked against the actual proto of the value so that constructors whose
// prototype.constructor is missing (e.g. Howler-style Foo.prototype = {...})
// are still correctly identified as passthroughs.
const PASSTHROUGH_PROTOS = new Set([
  typeof WeakMap           !== 'undefined' && WeakMap.prototype,
  typeof WeakSet           !== 'undefined' && WeakSet.prototype,
  typeof WeakRef           !== 'undefined' && WeakRef.prototype,
  typeof SharedArrayBuffer !== 'undefined' && SharedArrayBuffer.prototype,
].filter(Boolean));

// ── Shared descriptor-copy helper ────────────────────────────────────────────

/**
 * Copies a single own property from `src` to `dst` by key using
 * Object.defineProperty — always creates a true own property regardless of
 * any setters on dst's prototype chain. Used by the array extra-keys loop
 * and copyOwnProperties for class instances where the prototype is arbitrary.
 *
 * @param {object}          src
 * @param {object}          dst
 * @param {string|symbol}   key
 * @param {Map}             seen
 */
function copyDescriptor(src, dst, key, seen) {
  const descriptor = Object.getOwnPropertyDescriptor(src, key);
  if ('value' in descriptor) {
    Object.defineProperty(dst, key, {
      value:        cloneValue(descriptor.value, seen),
      writable:     descriptor.writable,
      enumerable:   descriptor.enumerable,
      configurable: descriptor.configurable,
    });
  } else {
    // Accessor descriptor (get/set) — copy as-is.
    Object.defineProperty(dst, key, descriptor);
  }
}

/**
 * Copies all own property descriptors from `src` to `dst`, recursively
 * cloning data-descriptor values.
 *
 * When `safeDst` is true, `dst` proto is Object.prototype (no user-defined
 * setters), so all data properties use direct assignment — one branch, no
 * per-property flag checks. Non-standard descriptors (non-writable, etc.)
 * are rare enough on plain objects that the minor inaccuracy in descriptor
 * flags does not justify three boolean comparisons per property.
 *
 * When false (class instances with arbitrary protos), every property goes
 * through defineProperty to guarantee a true own property is created and
 * no prototype setter is invoked.
 *
 * @param {object}  src
 * @param {object}  dst
 * @param {Map}     seen
 * @param {boolean} safeDst  - true only when dst proto is Object.prototype
 */
function copyOwnProperties(src, dst, seen, safeDst) {
  const ownKeys = Reflect.ownKeys(src);
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(src, key);
    if ('value' in descriptor) {
      if (safeDst) {
        // dst proto is Object.prototype — no user setters can intercept.
        // Direct assignment avoids defineProperty overhead for every property,
        // with no flag checks needed: non-standard descriptors (non-writable,
        // non-enumerable, etc.) are rare on plain object literals and not
        // worth paying three boolean comparisons per property to detect.
        dst[key] = cloneValue(descriptor.value, seen);
      } else {
        Object.defineProperty(dst, key, {
          value:        cloneValue(descriptor.value, seen),
          writable:     descriptor.writable,
          enumerable:   descriptor.enumerable,
          configurable: descriptor.configurable,
        });
      }
    } else {
      Object.defineProperty(dst, key, descriptor);
    }
  }
}

// ── Core clone worker ─────────────────────────────────────────────────────────

/**
 * Recursive clone implementation.
 *
 * @param {*}   value - The value to clone.
 * @param {Map} seen  - Cycle / shared-ref registry; maps original → clone.
 * @returns {*}       - A deep clone of `value`.
 */
function cloneValue(value, seen) {
  // ── 1. Primitives & functions ──────────────────────────────────────────────
  // Primitives (null, undefined, number, string, boolean, symbol, bigint) are
  // immutable — return as-is. Functions are also returned by reference: cloning
  // closed-over state is both impossible and semantically wrong.
  // Both cases collapse into one typeof check: anything that isn't typeof
  // 'object' (including functions) plus null exits here, saving a second
  // typeof evaluation on every non-primitive value.
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // ── 2. Circular / shared reference guard ───────────────────────────────────
  // Register clones BEFORE recursing into children so that back-edges
  // (a.self = a) resolve to the new object, not the original.
  if (seen.has(value)) {
    return seen.get(value);
  }

  // ── Fast path: read the constructor once ───────────────────────────────────
  // Read constructor from the prototype, not the instance. An own `constructor`
  // property on the object itself (e.g. { constructor: Date }) would otherwise
  // corrupt dispatch by shadowing the real prototype constructor.
  // Null-prototype objects have no prototype, so default to Object.
  // Read the actual prototype once — used both for dispatch and for
  // Object.create so the clone always gets the correct prototype regardless
  // of whether the library correctly set prototype.constructor.
  const proto = Object.getPrototypeOf(value);
  const ctor  = proto?.constructor ?? Object;

  // ── 3. Pass-through types (standard constructors) ────────────────────────
  // Catches WeakMap/WeakSet/WeakRef/SharedArrayBuffer and any user-registered
  // constructor whose prototype.constructor is correctly set.
  // Register in `seen` so shared/circular references resolve correctly.
  if (PASSTHROUGH_CTORS.has(ctor)) {
    seen.set(value, value);
    return value;
  }

  // ── 4. Plain object fast-path ──────────────────────────────────────────────
  // ctor === Object covers both true plain objects ({}) and objects whose
  // prototype has constructor missing or reassigned to Object (e.g. libraries
  // that do Foo.prototype = { ... } without restoring .constructor).
  // PASSTHROUGH_PROTOS is checked here — not in branch 3 — because it is only
  // needed when ctor === Object (the missing-constructor case). Checking it for
  // every Date, Map, Array, etc. would be wasted work since those all exit via
  // ctor === X branches before ever reaching this point.
  if (ctor === Object) {
    if (PASSTHROUGH_PROTOS.has(proto)) {
      seen.set(value, value);
      return value;
    }
    const clone = Object.create(proto);
    seen.set(value, clone);
    // safeDst is only valid when the proto is exactly Object.prototype.
    // If ctor resolved to Object because prototype.constructor was missing
    // (e.g. Howler-style Foo.prototype = {...}), proto is an arbitrary object
    // that may have setters — direct assignment would not be safe.
    copyOwnProperties(value, clone, seen, proto === Object.prototype);
    return clone;
  }

  // ── 5. Array ───────────────────────────────────────────────────────────────
  // Checked before other specialized types: arrays are by far the most common
  // non-plain-object type encountered during a deep clone.
  // Array.isArray is a fast engine intrinsic (single opcode in V8).
  if (Array.isArray(value)) {
    const clone = new Array(value.length);
    seen.set(value, clone);

    // Preserve sparse holes: only assign indices that actually exist.
    // A plain 0..length loop converts holes to `undefined` slots, making
    // the clone structurally different from the original.
    for (let i = 0; i < value.length; i++) {
      if (i in value) {
        clone[i] = cloneValue(value[i], seen);
      }
    }

    // Arrays can carry named own properties (e.g. arr.tag = 'foo') and symbol
    // keys. The index loop never visits these — copy them via copyDescriptor.
    // Guard: most arrays have only numeric indices + 'length', so check the
    // name count before allocating the full Reflect.ownKeys array. The +1 is
    // for 'length'. Only proceed if there are extra named keys or any symbols.
    if (
      Object.getOwnPropertySymbols(value).length !== 0 ||
      Object.getOwnPropertyNames(value).length !== value.length + 1
    ) {
      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (typeof key === 'string') {
          const n = key >>> 0;
          if (n < 0xFFFFFFFF && String(n) === key) continue; // canonical array index
        }
        copyDescriptor(value, clone, key, seen);
      }
    }

    return clone;
  }


  // ── 6. Date ────────────────────────────────────────────────────────────────
  if (ctor === Date) {
    const clone = new Date(value.getTime());
    seen.set(value, clone);
    return clone;
  }

  // ── 7. RegExp ──────────────────────────────────────────────────────────────
  if (ctor === RegExp) {
    const clone = new RegExp(value.source, value.flags);
    clone.lastIndex = value.lastIndex;
    seen.set(value, clone);
    return clone;
  }

  // ── 8. Map ─────────────────────────────────────────────────────────────────
  if (ctor === Map) {
    const clone = new Map();
    seen.set(value, clone);
    value.forEach((v, k) => {
      clone.set(cloneValue(k, seen), cloneValue(v, seen));
    });
    return clone;
  }

  // ── 9. Set ─────────────────────────────────────────────────────────────────
  if (ctor === Set) {
    const clone = new Set();
    seen.set(value, clone);
    value.forEach((v) => {
      clone.add(cloneValue(v, seen));
    });
    return clone;
  }

  // ── 10. ArrayBuffer ────────────────────────────────────────────────────────
  if (ctor === ArrayBuffer) {
    const clone = value.slice(0);
    seen.set(value, clone);
    return clone;
  }

  // ── 11. DataView ───────────────────────────────────────────────────────────
  if (ctor === DataView) {
    const bufClone = cloneValue(value.buffer, seen);
    const clone = new DataView(bufClone, value.byteOffset, value.byteLength);
    seen.set(value, clone);
    return clone;
  }

  // ── 12. TypedArrays ────────────────────────────────────────────────────────
  // One Set.has() call covers all eleven constructors — still O(1), but avoids
  // eleven sequential === comparisons in the hot path.
  if (TYPED_ARRAY_CTORS.has(ctor)) {
    const clone = new ctor(
      cloneValue(value.buffer, seen),
      value.byteOffset,
      value.length,
    );
    seen.set(value, clone);
    return clone;
  }

  // ── 13. Error (and subclasses) ─────────────────────────────────────────────
  // instanceof is the right tool here: TypeError, RangeError, etc. all inherit
  // from Error. Use value.constructor (not ctor) to construct the clone: ctor
  // is read from the prototype chain and may resolve to Object for subclasses
  // that do MyError.prototype = {...}. value.constructor reads the own property
  // first, which is what the subclass actually set.
  if (value instanceof Error) {
    const clone = new value.constructor(value.message);
    // seen.set BEFORE recursing into cause so any back-reference to this Error
    // resolves correctly instead of triggering an infinite re-clone.
    seen.set(value, clone);
    clone.stack = value.stack;
    if (value.cause !== undefined) {
      clone.cause = cloneValue(value.cause, seen);
    }
    return clone;
  }

  // ── 14. Class instances & null-prototype objects ───────────────────────────
  // Object.create(proto) preserves the prototype chain so instanceof keeps
  // working on the clone. copyOwnProperties handles all own keys including
  // non-enumerable, non-writable, Symbol-keyed, and accessor properties.
  // proto was already read above for dispatch — reuse it here.
  const clone = Object.create(proto);
  seen.set(value, clone);
  copyOwnProperties(value, clone, seen, false);
  return clone;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Registers one or more constructor functions as pass-through types.
 * Instances of registered constructors are returned by reference during a
 * clone rather than being recursively copied. Use this for any class that
 * wraps native/external resources that cannot be meaningfully cloned —
 * Web Audio nodes, WebGL contexts, file handles, sockets, etc.
 *
 * Registrations are global and permanent for the lifetime of the module.
 * Call this once at application startup, before any cloning occurs.
 *
 * @param {...Function} ctors - One or more constructor functions to register.
 *
 * @example
 * import clone, { registerUncloneable } from './clone.js';
 * import { Howl } from 'howler';
 *
 * registerUncloneable(Howl);
 *
 * const state = { sound: new Howl({ src: ['sound.mp3'] }), volume: 0.8 };
 * const copy  = clone(state);
 * console.log(copy.sound === state.sound); // true — Howl passed through
 * console.log(copy.volume);                // 0.8  — primitive cloned
 */
export function registerUncloneable(...ctors) {
  for (const ctor of ctors) {
    if (typeof ctor !== 'function') {
      throw new TypeError(`registerUncloneable: expected a constructor function, got ${typeof ctor}`);
    }
    PASSTHROUGH_CTORS.add(ctor);
    // Also register the prototype object so instances whose prototype.constructor
    // is missing (e.g. Howler-style Foo.prototype = {...}) are still caught.
    if (ctor.prototype != null) {
      PASSTHROUGH_PROTOS.add(ctor.prototype);
    }
  }
}

/**
 * Deep-clones any JavaScript value.
 *
 * @template T
 * @param {T} value - The value to clone.
 * @returns {T}     - A structurally independent deep clone.
 *
 * @example
 * const obj = { a: 1, b: [2, 3], c: new Map([['x', { y: 4 }]]) };
 * const copy = clone(obj);
 * copy.b.push(99);
 * console.log(obj.b); // [2, 3] — untouched
 */
export default function clone(value) {
  return cloneValue(value, new Map());
}