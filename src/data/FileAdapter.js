import fs from 'fs/promises';
import DebugLogger from 'debug';

import config from '#config/server.js';
import migrate from '#data/migrate.js';
import ServerError from '#server/Error.js';
import Timeout from '#server/Timeout.js';
import emitter from '#utils/emitter.js';
import serializer from '#utils/serializer.js';

export const FILES_DIR = 'src/data/files';
export const ARCHIVE_DIR = 'src/data/archive';
const ops = new Map([
  [ 'create', '_createFile' ],
  [ 'get',    '_getFile' ],
  [ 'put',    '_putFile' ],
  [ 'delete', '_deleteFile' ],
  [ 'stat',   '_statFile' ],
]);

/*
 * Wrap FS operations that require file descriptors.
 * Once the file descriptor count reaches the max, block operations until previous ones clear.
 */
const maxOpenFiles = 1024;
const fsStack = [];
let numOpenFiles = 0;

const FS_NEXT = ({ method, args, resolve, reject }) => {
  numOpenFiles++;
  return fs[method](...args).then(resolve, reject).finally(() => {
    numOpenFiles--;
    while (fsStack.length && numOpenFiles < maxOpenFiles)
      FS_NEXT(fsStack.shift());
  });
};

const FS = (method, ...args) => new Promise((resolve, reject) => {
  if (numOpenFiles === maxOpenFiles)
    fsStack.push({ method, args, resolve, reject });
  else
    FS_NEXT({ method, args, resolve, reject });
});

const querySchema = {
  $schema: 'http://json-schema.org/draft-07/schema',
  $ref: '#/definitions/query',
  definitions: {
    query: {
      oneOf: [
        {
          type: 'array',
          items: { $ref:'#/definitions/querySingle' },
        },
        {
          $ref: '#/definitions/querySingle',
        },
      ],
    },
    querySingle: {
      type: 'object',
      properties: {
        filter: { $ref:'#/definitions/filter' },
        sort: { $ref:'#/definitions/sort' },
        limit: { type:'number' },
      },
      additionalProperties: false,
    },
    filter: {
      oneOf: [
        {
          type: 'array',
          items: { $ref:'#/definitions/filterSingle' },
        },
        {
          $ref: '#/definitions/filterSingle',
        },
      ],
    },
    filterSingle: {
      type: 'object',
      properties: {
        '!': { $ref:'#/definitions/filter' },
        '&': { $ref:'#/definitions/filter' },
      },
      additionalProperties: { $ref:'#/definitions/condition' },
    },
    condition: {
      oneOf: [
        {
          type: 'array',
          items: { $ref:'#/definitions/primitive' },
        },
        {
          $ref:'#/definitions/primitive',
        },
        {
          type: 'object',
          properties: {
            '!': { $ref:'#/definitions/condition' },
            '~': {
              type: 'string',
              subType: 'RegExp',
            },
          },
          additionalProperties: false,
        },
      ],
    },
    primitive: {
      type: [ 'null', 'string', 'number', 'boolean' ],
    },
  },
};
// Serializer needs to support recursive schemas before we can use it.
//const validateQuery = serializer.makeValidator('data:query', querySchema);

const stateBuffer = new Timeout('state', config.buffer).on('expire', async ({ data:items }) => {
  for (const [ itemId, item ] of items) {
    FileAdapter._putJSONFile(itemId, item);
  }
});

export default class FileAdapter {
  constructor(props) {
    Object.assign(this, {
      debug: DebugLogger(`data:${props.name}`),
      debugV: DebugLogger(`data-v:${props.name}`),
      fileTypes: new Map(),
      readonly: process.env.READONLY === 'true',
      hasState: false,
      // State is intended to always be resident in memory.
      // It is saved on server shut down and restored on start up.
      // It should only contain ephemeral data or indexed data.
      state: null,
      cache: new Map(),
      buffer: new Map(),
      queue: new Map(),
      filesDir: `${FILES_DIR}/${props.name}`,
      archiveDir: `${ARCHIVE_DIR}/${props.name}`,
    }, props);

    for (const [ fileType, fileConfig ] of this.fileTypes) {
      const cache = new Timeout(
        `${fileType}Cache`,
        Object.assign({}, config.cache, fileConfig.cache),
      );
      const buffer = new Timeout(
        `${fileType}Buffer`,
        Object.assign({}, config.buffer, fileConfig.buffer),
      );

      fileConfig.whenSaved = new WeakMap();
      this.cache.set(fileType, cache);
      this.buffer.set(fileType, buffer);

      cache.on('expire', ({ data:items }) => {
        for (const [ itemId, item ] of items) {
          this.debugV(`${cache.name}:expire=${itemId}; destroy=${!buffer.has(itemId)}`);
          if (!buffer.has(itemId) && 'destroy' in item)
            item.destroy();
        }
      });
      buffer.on('expire', async ({ data:items }) => {
        await Promise.all([ ...items.values() ].map(item => {
          const whenSaved = (fileConfig.whenSaved.get(item) ?? Promise.resolve()).then(() => this[fileConfig.saver](item));
          fileConfig.whenSaved.set(item, whenSaved);
          return whenSaved;
        }));
        for (const [ itemId, item ] of items) {
          this.debugV(`${buffer.name}:expire=${itemId}; destroy=${!cache.has(itemId)}`);
          if (!cache.has(itemId) && 'destroy' in item)
            item.destroy();
        }
      });
    }
  }

  getStatus() {
    const status = {};
    for (const fileType of this.fileTypes.keys()) {
      status[fileType] = {
        open: this.cache.get(fileType).openedSize,
        cached: this.cache.get(fileType).size,
        buffered: this.buffer.get(fileType).size,
      };
    }

    return Object.assign(status, {
      queued: this.queue.size,
    });
  }

  /*
   * The state feature seems to be a bit of an anti-pattern.  It doesn't seem
   * to mitigate the harm from a sudden shut down.
   */
  async bootstrap() {
    if (this.hasState) {
      this.state = await FileAdapter._readJSONFile(this.name, {});
    }

    return this;
  }

  /*
   * While not strictly necessary to call this method to save state, calling it
   * allows us to track state changes during server run time.  It also makes it
   * safer to forcefully start a server after not being gracefully shut down.
   */
  saveState() {
    stateBuffer.add(this.name, this.state);
  }

  async flush() {
    const promises = [];

    for (const [ fileType, fileConfig ] of this.fileTypes)
      for (const item of this.buffer.get(fileType).clear())
        promises.push(this[fileConfig.saver](item).catch(error => {
          console.log(`Error while saving ${fileType} item: ${error}`);
        }));

    return Promise.all(promises);
  }
  async cleanup() {
    await this.flush();

    if (this.hasState) {
      stateBuffer.pause();
      await FileAdapter._putJSONFile(this.name, this.state);
    }

    return this;
  }

  _migrate(type, data, migrateProps) {
    if (typeof data !== 'object' || data === null) return data;

    return serializer.normalize(migrate(type, data, migrateProps));
  }

  /*
   * The file must not already exist
   */
  async createFile(fileName, ...args) {
    if (args.length === 1 && typeof args[0] === 'function')
      args.unshift(undefined);
    else if (args.length === 1)
      args.push(v => v);

    return this._pushQueue(fileName, { type:'create', args });
  }
  /*
   * Return the initial value (or throw error) if the file does not exist.
   * Read the file if it does exist.
   *
   * Overloaded:
   *   getFile(fileName)
   *   getFile(fileName, initialValue)
   *   getFile(fileName, transform)
   *   getFile(fileName, initialValue, transform)
   */
  async getFile(fileName, ...args) {
    if (args.length === 0)
      args = [ undefined, v => v ];
    else if (args.length === 1 && typeof args[0] === 'function')
      args.unshift(undefined);
    else if (args.length === 1)
      args.push(v => v);

    return this._pushQueue(fileName, { type:'get', args }, queue => {
      /*
       * It is possible for two getFile attempts to be made concurrently.
       * In this case, de-dup by returning the same promise.
       * This does assume the transform argument is always the same.
       */
      const op = queue.find(q => q.type === 'get');
      if (op)
        return op.promise;
    });
  }
  /*
   * Create the file if it does not exist.
   * Overwrite the file if it does exist.
   */
  async putFile(fileName, ...args) {
    if (args.length === 1 && typeof args[0] === 'function')
      args.unshift(undefined);
    else if (args.length === 1)
      args.push(v => v);

    return this._pushQueue(fileName, { type:'put', args });
  }
  async archiveFile(fileName) {
    const fqSource = `${this.filesDir}/${fileName}.json`;
    const fqTarget = `${this.archiveDir}/${fileName}.json`;
    const fqTargetDir = fqTarget.slice(0, fqTarget.lastIndexOf('/'));

    await fs.mkdir(fqTargetDir, { recursive:true });
    try {
      await fs.rename(fqSource, fqTarget);
    } catch (error) {
      if (error.code === 'ENOENT')
        return;
      throw error;
    }
  }
  /*
   * Pretend the file was deleted if it does not exist.
   * Remove the file if it does exist.
   */
  async deleteFile(fileName) {
    if (this.readonly)
      return;

    return this._pushQueue(fileName, { type:'delete', args:[] });
  }
  async statFile(fileName, ifExists = false) {
    return this._pushQueue(fileName, { type:'stat', args:[ ifExists ] });
  }

  async _pushQueue(fileName, op, resolveConflict) {
    op.method = ops.get(op.type);
    op.args = op.args ?? [];
    op.promise = new Promise((resolve, reject) => {
      op.resolve = resolve;
      op.reject = reject;
    });

    if (this.queue.has(fileName)) {
      const queue = this.queue.get(fileName);

      if (resolveConflict) {
        const value = resolveConflict(queue);
        if (value !== undefined)
          return value;
      }

      this.debug(`Warning: calling ${op.method} on queued file '${fileName}'`);
      this.debug(`Queue: ${queue.map(q => q.type).join(', ')}`);
      queue.push(op);
    } else {
      this.queue.set(fileName, [ op ]);
      this._processQueue(fileName);
    }

    return op.promise;
  }
  async _processQueue(fileName) {
    const queue = this.queue.get(fileName);

    while (queue.length) {
      const op = queue[0];

      await this[op.method](fileName, ...op.args)
        .then(value => op.resolve(value))
        .catch(error => op.reject(error));

      queue.shift();
    }

    this.queue.delete(fileName);
  }

  _createFile(name, data, transform) {
    if (this.readonly)
      return;

    const fqName = `${this.filesDir}/${name}.json`;

    return FS('writeFile', fqName, JSON.stringify(transform(data)), { flag:'wx' }).catch(error => {
      console.log('createFile', error);
      throw new ServerError(500, 'Create failed');
    });
  }
  async _getFile(name, initialValue, transform) {
    const fqName = `${this.filesDir}/${name}.json`;

    try {
      const data = await FS('readFile', fqName, { encoding:'utf8' })
      return transform(JSON.parse(data));
    } catch (error) {
      if (error.message === 'Unexpected end of JSON input')
        error = new ServerError(500, `Corrupt: ${fqName}`);
      else if (error.code === 'ENOENT') {
        const data = await transform(initialValue);
        if (data === undefined)
          error = new ServerError(404, `Not found: ${fqName}`);
        else
          return data;
      }

      throw error;
    }
  }
  async _putFile(name, data, transform) {
    if (this.readonly)
      return;

    const parts = name.split('/');
    const dirPart = parts.slice(0, -1).join('/');
    const filePart = parts.last;
    const fqDir = dirPart.length ? `${this.filesDir}/${dirPart}` : this.filesDir;

    try {
      await fs.access(fqDir);
    } catch (error) {
      await fs.mkdir(fqDir, { recursive:true });
    }

    const fqNameTemp = `${fqDir}/.${filePart}.json`;
    const fqName = `${fqDir}/${filePart}.json`;

    await FS('writeFile', fqNameTemp, JSON.stringify(transform(data))).catch(error => {
      console.log('writeFile', error);
      throw new ServerError(500, 'Save failed');
    });

    await fs.rename(fqNameTemp, fqName).catch(error => {
      console.log('rename', error);
      throw new ServerError(500, 'Save failed');
    });
  }
  _deleteFile(name) {
    const fqName = `${this.filesDir}/${name}.json`;

    return fs.unlink(fqName).catch(error => {
      if (error.code === 'ENOENT')
        return null;

      console.log('deleteFile', error);
      throw new ServerError(500, 'Delete failed');
    });
  }
  _statFile(name, ifExists = false) {
    const fqName = `${this.filesDir}/${name}.json`;

    return fs.stat(fqName).catch(error => {
      if (error.code === 'ENOENT' && ifExists)
        return null;

      console.log('statFile', error);
      throw new ServerError(500, 'Stat failed');
    });
  }

  /*
   * These methods are for internal use for THIS class.
   */
  static _hasJSONFile(name) {
    return fs.stat(`${FILES_DIR}/${name}.json`).then(stats => {
      return stats.isFile();
    }).catch(error => {
      if (error.code === 'ENOENT')
        return false;

      throw error;
    });
  }
  static _readJSONFile(name, initial) {
    return FS('readFile', `${FILES_DIR}/${name}.json`, { encoding:'utf8' }).then(data => {
      return serializer.parse(data);
    }).catch(error => {
      if (error.code === 'ENOENT') {
        if (typeof initial === 'function')
          return initial();
        else if (initial !== undefined)
          return initial;
      }

      throw error;
    });
  }
  static _createJSONFile(name, data) {
    return FS('writeFile', `${FILES_DIR}/${name}.json`, serializer.stringify(data), { flag:'wx' });
  }
  static _putJSONFile(name, data) {
    return FS('writeFile', `${FILES_DIR}/${name}.json`, serializer.stringify(data));
  }
  static _deleteJSONFile(name) {
    return fs.unlink(`${FILES_DIR}/${name}.json`).then(() => {
      return true;
    }).catch(error => {
      if (error.code === 'ENOENT')
        return false;

      throw error;
    });
  }
};

emitter(FileAdapter);
