import fs from 'fs/promises';
import DebugLogger from 'debug';

import config from '#config/server.js';
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
]);

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

      this.cache.set(fileType, cache);
      this.buffer.set(fileType, buffer);

      cache.on('expire', ({ data:items }) => {
        for (const [ itemId, item ] of items) {
          this.debugV(`cache:expire=${itemId}; destroy=${!buffer.has(itemId)}`);
          if (!buffer.has(itemId))
            item.destroy();
        }
      });
      buffer.on('expire', async ({ data:items }) => {
        await Promise.all([ ...items.values() ].map(i => this[fileConfig.saver](i)));
        for (const [ itemId, item ] of items) {
          this.debugV(`buffer:expire=${itemId}; destroy=${!cache.has(itemId)}`);
          if (!cache.has(itemId))
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
      /*
       * This check is for detecting a graceless shutdown.  Graceful shutdowns
       * protect against lost data.  Without this check, we might not notice if
       * a server did not gracefully shut down.  This might result in games not
       * auto surrendering when they should or even become stuck - the next turn
       * never starting.
       *
       * TODO: Create a script that allows us to safely recover from a graceless
       *       shutdown.
       */
      try {
        await FileAdapter._createJSONFile(`${this.name}.lock`, { startupAt:new Date() });
      } catch (error) {
        if (error.code === 'EEXIST')
          throw new Error('Lock file exists.  Try `npm run start-force`.');
        throw error;
      }

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

  async cleanup() {
    const promises = [];

    for (const [ fileType, fileConfig ] of this.fileTypes)
      for (const item of this.buffer.get(fileType).clear())
        promises.push(this[fileConfig.saver](item));

    await Promise.all(promises);

    if (this.hasState) {
      stateBuffer.pause();
      await FileAdapter._putJSONFile(this.name, this.state);

      await FileAdapter._deleteJSONFile(`${this.name}.lock`);
    }

    return this;
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
    return this._pushQueue(fileName, { type:'delete', args:[] });
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

  /*
   * Only call these methods while a lock is in place.
   */
  _createFile(name, data, transform) {
    const fqName = `${this.filesDir}/${name}.json`;

    return fs.writeFile(fqName, JSON.stringify(transform(data)), { flag:'wx' }).catch(error => {
      console.log('createFile', error);
      throw new ServerError(500, 'Create failed');
    });
  }
  async _getFile(name, initialValue, transform) {
    const fqName = `${this.filesDir}/${name}.json`;

    try {
      const data = await fs.readFile(fqName, { encoding:'utf8' })
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

    await fs.writeFile(fqNameTemp, JSON.stringify(transform(data))).catch(error => {
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
      console.log('deleteFile', error);
      throw new ServerError(500, 'Delete failed');
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
    return fs.readFile(`${FILES_DIR}/${name}.json`, { encoding:'utf8' }).then(data => {
      return serializer.parse(data);
    }).catch(error => {
      if (error.code === 'ENOENT' && initial !== undefined)
        return initial;

      throw error;
    });
  }
  static _createJSONFile(name, data) {
    return fs.writeFile(`${FILES_DIR}/${name}.json`, serializer.stringify(data), { flag:'wx' });
  }
  static _putJSONFile(name, data) {
    return fs.writeFile(`${FILES_DIR}/${name}.json`, serializer.stringify(data));
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

  /*
   * It doesn't matter what the query syntax is, so long as the client and the
   * data adapter can understand it.  As a rule, the server should not be in the
   * business of constructing queries.  If the server needs a filtered data set,
   * then a specialized data adapter method should be created to provide it.
   *
   * With all that said, I'm working with a JSON representation of a query using
   * the following structure that I expect would be intuitive and readable.
   *
   * Query structure:
   *   {
   *     "filters": filter,         // nested list of filters
   *     "page": #pageNumber#,      // base 1
   *     "limit": #ResultsPerPage#, // default 10
   *     "sort": [sort],            // list of sort criteria
   *   }
   *
   * Filter structure:
   *   A filter is either an array or an object.  The brackets and braces are
   *   similar to parenthetical groups of groups or conditions that are joined
   *   using a boolean 'OR' or 'AND' operator respectively.
   *
   *   JSON: { "isEnded":true, "teams[].playerId":[123,456] }
   *   SQL : ( isEnded = true AND teams[].playerId IN (123,456) )
   *
   *   JSON: [{ "started":null }, { "teams[].playerId":[123,456] }]
   *   SQL : (( started IS null ) OR ( teams[].playerId IN (123,456)))"
   *
   *   The "AND" operator can be applied to a group.  If the group is an array,
   *   all the conditions in the array must be true even though arrays are
   *   usually processed using "OR" operators.
   *
   *   JSON: { "&": [{ "started":null }, { "teams[].playerId":[123,456] }] }
   *   SQL : (( started IS NULL ) AND ( teams[].playerId IN (123,456) ))
   *
   *   The "NOT" operator can be applied to a group.  These expressions are the
   *   negated versions of the above.  Unlike most object filters, the "!"
   *   property is not treated as a field name.
   *
   *   JSON: { "!": { "isEnded":true }, "teams[].playerId":[123,456] } }
   *   SQL : NOT ( isEnded = true ) AND teams[].playerId IN (123,456) )
   *
   *   JSON: { "!": [{ "started":null }, { "teams[].playerId":[123,456] }] }
   *   SQL : NOT (( started IS null ) OR ( teams[].playerId IN (123,456)))"
   *
   *   Besides the implied "=" and "IN" operators demonstrated above, other
   *   condition operators can also be used if the value is an object.
   *   I haven't implemented special condition operators, but here are a few.
   *
   *   JSON: { "nameOfStringField":   { "match":"^regex"               } }
   *   JSON: { "nameOfNumberField:    { "between":[5, 7]               } }
   *   JSON: { "nameOfDateField":     { ">":"2019-07-08T00:00:00.000Z" } }
   *   JSON: { "nameOfOptionalField": { "exists":true                  } }
   *   JSON: { "nameOfArrayField":    { "isDeeply":[1, 2, 3]           } }
   *
   *   Also, you might have noticed the use of '[]' after 'teams'.  This is to
   *   recognize that 'teams' is an array, so the filter is applied to each
   *   element of the array to test if any of them is a hit.  To operate upon a
   *   subset of elements, use this syntax:
   *
   *   teams[0]:null            // The first team must be null
   *   teams[-1]:null           // The last team must be null
   *   teams[0, 1]:null         // Either the first or second team is null.
   *   teams[0-1]:null          // Same behavior as the previous example.
   *
   * Sort structure:
   *   Each element in the sort list is either a string or object.  If a string,
   *   then it is the field name.  Nested fields use dot separators.
   *   {
   *     "field": <field>,
   *     "order": "asc" | "desc",
   *   }
   *
   * Return structure:
   *   {
   *     "page": #pageNumber#,
   *     "limit": #ResultsPerPage#,
   *     "count": #TotalResults#,
   *     "hits": [...],  // list of game summaries
   *   }
   */
  _search(data, query) {
    /*
    try {
      validateQuery(query);
    } catch(e) {
      if (e.constructor === Array) {
        // User-facing validation errors are treated manually with specific messages.
        // So, be verbose since failures indicate a problem with the schema or client.
        console.error('search', JSON.stringify(query, null, 2));
        console.error('errors', e);
        e = new ServerError(422, 'Validation error');
      }

      throw e;
    }
    */

    const multiQuery = query.constructor === Array;
    if (!multiQuery)
      query = [ query ];

    const results = [];
    for (const q of query) {
      Object.assign(q, Object.assign({ page:1, limit:10 }, q));

      if (q.limit > 50)
        throw new ServerError(400, 'Maximum limit is 50');

      const offset = (q.page - 1) * q.limit;
      const hits = data
        .filter(this._compileFilter(q.filter))
        .sort(this._compileSort(q.sort));

      results.push({
        page: q.page,
        limit: q.limit,
        count: hits.length,
        hits: hits.slice(offset, offset+q.limit),
      });
    }

    if (multiQuery)
      return results;
    return results[0];
  }
  _compileFilter(filter) {
    if (!filter)
      return item => true;

    return item => this._matchItem(item, filter);
  }
  _matchItem(item, filter) {
    if (Array.isArray(filter))
      // OR logic: return true for the first sub-filter that returns true.
      // Otherwise, return false.
      return filter.findIndex(f => this._matchItem(item, f)) > -1;
    else if (filter !== null && typeof filter === 'object')
      // AND logic: return false for the first sub-filter that returns false.
      // Otherwise, return true.
      return Object.keys(filter)
        .findIndex(f => !this._matchItemByCondition(item, f, filter[f])) === -1;
    else
      throw new Error('Malformed filter');
  }
  _matchItemByCondition(item, path, condition) {
    /*
     * These are group operators.
     *   Example: { "!":{ ... } }
     */
    if (path === '!')
      return !this._matchItem(item, condition);
    else if (path === '&') {
      if (!Array.isArray(condition))
        condition = [ condition ];

      // AND logic: return false for the first sub-filter that returns false.
      // Otherwise, return true.
      return condition.findIndex(c => !this._matchItem(item, c)) === -1;
    }

    const value = this._extractItemValue(item, path);

    /*
     * When the condition is not an object, the value and condition data types
     * are expected to be null, number, string, or arrays of the same.
     */
    if (condition === null || typeof condition !== 'object') {
      if (value === null || typeof value !== 'object')
        return value === condition;
      else if (value.constructor === Array)
        return value.includes(condition);
    } else if (condition.constructor === Array) {
      if (value === null || typeof value !== 'object')
        return condition.includes(value);
      else if (value.constructor === Array)
        if (value.length > condition.length)
          return condition.findIndex(c => value.includes(c)) > -1;
        else
          return value.findIndex(v => condition.includes(v)) > -1;
    } else if (condition.constructor === Object) {
      // Find the first condition that does NOT match, if none return TRUE
      return !Object.entries(condition).find(([ cKey, cValue ]) => {
        /*
         * These are value operators.
         *   Example: { "field":{ "!":"value" } }
         */
        if (cKey === '!')
          return this._matchItemByCondition(value, '', cValue);
        else if (cKey === '~') {
          if (typeof value !== 'string')
            return true;
          if (typeof cValue?.source !== 'string' || typeof cValue?.flags !== 'string')
            throw new ServerError(400, `The '${cKey}' condition must have a RegExp value`);

          return !(new RegExp(cValue.source, cValue.flags).test(value));
        } else
          throw new ServerError(400, `The '${cKey}' condition is not supported`);
      });
    }
  }
  _extractItemValue(item, path) {
    if (item === null || path.length === 0)
      return item;

    let fields = path.split('.');
    let value = item;

    while (fields.length) {
      let field = fields.shift();
      let slice = field.match(/\[.*?\]$/);
      if (slice) {
        field = field.slice(0, slice.index);
        slice = slice[0].slice(1, -1);
      }

      if (!(field in value))
        return null;

      value = value[field];

      if (value === null)
        return null;

      if (slice !== null) {
        if (!Array.isArray(value))
          throw new Error('Range applied to non-array value');

        let elements = [];

        if (slice.trim().length === 0)
          elements = value;
        else {
          let indices = slice.split(/\s*,\s*/);
          while (indices.length) {
            let index = indices.shift();
            let range = index.split(/\s*-\s*/);

            if (range.length === 2)
              elements.push(...value.slice(...range));
            else if (range.length === 1)
              elements.push(value[range]);
            else
              throw new Error('Invalid range in filter array slice');
          }
        }

        let subPath = fields.join('.');

        return elements.map(el => this._extractItemValue(el, subPath));
      }
    }

    return value;
  }

  _compileSort(sort) {
    if (!sort)
      return (a, b) => 0;

    if (typeof sort === 'string')
      return (a, b) => this._sortItemsByField(a, b, sort);
    else if (Array.isArray(sort))
      throw new ServerError(501, 'Sorting by multiple fields is not supported');
    else if (sort !== null && typeof sort === 'object') {
      if (sort.order === 'desc')
        return (a, b) => this._sortItemsByField(b, a, sort.field);
      else
        return (a, b) => this._sortItemsByField(a, b, sort.field);
    }
    else
      throw new ServerError(400, 'Unexpected sort data type');
  }
  _sortItemsByField(a, b, field) {
    if (a[field] < b[field]) return -1;
    if (b[field] < a[field]) return 1;
    return 0;
  }
};

emitter(FileAdapter);
