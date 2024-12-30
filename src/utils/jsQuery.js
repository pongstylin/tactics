import assert from 'assert';
import { search as jp } from '@metrichor/jmespath';

import ServerError from '#server/Error.js';

/*
 * Abstract:
 *   The abstract view of jsonQuery is this:
 *   <operand> <operator> <test>
 *
 *   Or, in its functional form:
 *   <operator>(<operand>, <test>)
 *
 * The search function accepts a filter object with this form:
 * 
 *   {
 *     // This implies the Equality operator for a scalar operand.
 *     <operand>: <scalarTest>,
 *
 *     // This implies the Includes operator for a scalar array operand.
 *     <operand>: <scalarArrayTest>,
 *
 *     // One or more operators may be explicitly applied to a given operand.
 *     <operand>: { <operator>:<operatorSpecificTest>, ... },
 *   }
 *
 * This is how some example filters map to the functional form.
 *
 *   // Scalar Equality
 *   { "field": "value" }
 *   eq(context["field"], "value")
 *
 *   // List includes
 *   { "field": [ "value", "value2" ] }
 *   in(context["field"], [ "value", "value2" ])
 *
 *   // Any other operator
 *   { "field": { not:"value" } }
 *   not(context["field"], "value")
 *
 *   // Multiple operators for one operand
 *   { "field": { gt:10, lt:20 } }
 *   gt(context["field"], 10)
 *   lt(context["field"], 20)
 *
 *   // Group expressions (JSON Path operand)
 *   { "$": { or:[ <filter>, ... ] } }
 *   or(context, [ <filter>, ... ])
 *
 *   // The filter object can be applied to sub lists to test for any hits.
 *   { "field": { "some":<filter> } }
 *   some(context["field"], <filter>)
 *
 * The operand is expressed using either field dot notation or a JSON Path.
 *
 * Of course, you could use JSON Path INSTEAD of JSON Query to filter a list,
 * but JSON Query was designed to offer a more structured syntax that can be
 * more easily conditionally patched by code.  It is also easier to add custom
 * named operators.
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
export const search = (context, query) => {
  const multiQuery = query.constructor === Array;
  if (!multiQuery)
    query = [ query ];

  const results = [];
  for (const q of query) {
    Object.assign(q, Object.assign({ page:1, limit:10 }, q));

    if (q.limit > 50)
      throw new ServerError(400, 'Maximum limit is 50');

    const offset = (q.page - 1) * q.limit;
    const hits = context
      .filter(ctx => predicates.test(ctx, { nested:q.filter }))
      .sort(_compileSort(q.sort));

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

export const test = (context, filter) => {
  return predicates.test(context, { nested:filter });
}

const regexpMap = new Map();
const compileRegex = s => {
  if (s.constructor === RegExp)
    return s;

  if (!regexpMap.has(s))
    regexpMap.set(s, new RegExp(...s.split('/').slice(1)));
  return regexpMap.get(s);
};
const queryJsonPath = (ctx, path) => {
  return jp(ctx, path);
};
const walkDottedPath = (ctx, path) => {
  return jp(ctx, `$.${path}`);
};
const coerceArray = a => a === undefined ? [] : Array.isArray(a) ? a : [ a ];

const aliases = new Map([
  [ '>',  'gt' ],
  [ '<',  'lt' ],
  [ '=',  'eq' ],
  [ '~',  're' ],
  [ '&',  'and' ],
  [ '|',  'or' ],
  [ '!',  'not' ],
  [ '.',  'nested' ],
]);

const predicates = {
  // Basic predicates
  eq(ctx, val) { return ctx === val; },
  in(ctx, val) { return val.includes(ctx); },

  gt(ctx, val) { return val > ctx; },
  lt(ctx, val) { return val < ctx; },
  ge(ctx, val) { return val >= ctx; },
  le(ctx, val) { return val <= ctx; },

  // Group predicates
  and(ctx, test) { return coerceArray(test).every(t => this.test(ctx, t)); },
  or(ctx, test) { return coerceArray(test).some(t => this.test(ctx, t)); },
  not(ctx, test) { return coerceArray(test).every(t => !this.test(ctx, t)); },

  is(ctx, val) {
    try {
      assert.deepStrictEqual(ctx, val);
      return true;
    } catch (e) {
      return false;
    }
  },

  nested(ctx, filter) {
    if (typeof ctx !== 'object' || ctx === null)
      return false;

    return coerceArray(filter).some(f => Object.entries(f).every(([ path, t ]) => {
      const operand = path.startsWith('$') ? queryJsonPath(ctx, path) : walkDottedPath(ctx, path);

      return this.test(operand, t);
    }));
  },

  // Test the current context to see if it is a match
  test(ctx, test) {
    if (Array.isArray(test))
      return this.in(ctx, test);
    else if (typeof test !== 'object' || test === null)
      return this.eq(ctx, test);

    return Object.entries(test).every(([ op, val ]) => {
      const dataType = ctx === null || ctx === undefined ? ctx : ctx.constructor;
      const that = Object.assign({}, predicates, predicatesByType.get(dataType));

      op = aliases.get(op) ?? op;
      if (!operators.has(op))
        throw new TypeError(`No such operator: ${op}`);
      if (!(op in that))
        return false;

      return that[op](ctx, val);
    });
  },
};
const predicatesByType = new Map([
  [ String, {
    re(ctx, val) { return compileRegex(val).test(ctx); },
    startsWith(ctx, val) { return ctx.startsWith(val); },
  } ],
  [ Array, {
    includes(ctx, val) { return ctx.includes(val); },
    intersects(ctx, val) { return ctx.some(c => val.includes(c)); },
    has(ctx, val) { return ctx.some(c => this.test(c, { is:val })); },
    some(ctx, val) { return ctx.some(c => this.nested(c, val)); },
  } ],
]);
const register = (types, predicates) => types.forEach(t => {
  predicatesByType.set(t, Object.assign(predicatesByType.get(t) ?? {}, predicates));
});
const operators = new Set([
  ...Object.keys(predicates),
  ...Array.from(predicatesByType.values()).map(v => Object.keys(v)).flat(),
]);

function _compileSort(sort) {
  if (!sort)
    return (a, b) => 0;

  if (typeof sort === 'string')
    return (a, b) => _sortItemsByField(a, b, sort);
  else if (Array.isArray(sort))
    throw new ServerError(501, 'Sorting by multiple fields is not supported');
  else if (sort !== null && typeof sort === 'object') {
    if (sort.order === 'desc')
      return (a, b) => _sortItemsByField(b, a, sort.field);
    else
      return (a, b) => _sortItemsByField(a, b, sort.field);
  } else
    throw new ServerError(400, 'Unexpected sort data type');
}
function _sortItemsByField(a, b, field) {
  if (a[field] < b[field]) return -1;
  if (b[field] < a[field]) return 1;
  return 0;
}
