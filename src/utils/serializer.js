/*
 * So that this module doesn't import the world, classes that require
 * serialization must import this module and call the addType function with the
 * name and constructor for the class.  Type names must be unique and should
 * match the class names.  They are used in the JSON representation to refer to
 * the constructor when deserializing.
 *
 * Serialization iterates over all array items and object keys to find class
 * instances that need it.  Such class instance fields are then annotated in a
 * transform tree for more efficient deserialization.  For more efficient
 * serialization, a transform tree may be provided.
 */
const types = [
  {
    name: 'Object',
    jsonType: 'Object',
    constructor: Object,
    serialize: (data, transform) => {
      const keys = Object.keys(data);
      const len = keys.length;
      const serialized = {};

      if (!transform.keys)
        transform.keys = new Map();

      for (let i = 0; i < len; i++) {
        const key = keys[i];
        const value = data[key];
        if (value === undefined)
          continue;
        else if (value === null) {
          serialized[key] = value;
          continue;
        }

        if (!transform.keys.has(key))
          transform.keys.set(key, { required:false, nullable:true });
        const keyTransform = transform.keys.get(key);

        if (typeof value === 'object')
          serialized[key] = serialize(value, keyTransform);
        else {
          serialized[key] = value;
          if (keyTransform.type === undefined)
            keyTransform.type = 'primitive';
          else if (keyTransform.type !== 'primitive')
            throw new TypeError('Type mismatch');
        }
      }

      return serialized;
    },
    normalize: (data, transform) => {
      const len = transform.keys.length;

      for (let i = 0; i < len; i++) {
        const key = transform.keys[i][0];
        const value = data[key];
        if (value === null || value === undefined)
          continue;

        const keyTransform = transform.keys[i][1];
        const keyType = typeMap.get(keyTransform.type);
        if (keyType === undefined)
          throw new TypeError(`The '${keyTransform.type}' type has not been added`);
        data[key] = keyType.normalize(value, keyTransform);
      }

      return data;
    },
    codify: (varName, varAlias, transform, newVar) => {
      if (transform.keys === undefined)
        return '';

      const code = [];

      for (const [ key, keyTransform ] of transform.keys) {
        const subVarName = `${varAlias}.${key}`;

        code.push(codify(subVarName, keyTransform, newVar));
      }

      return code.join('');
    },
  },
  {
    name: 'Array',
    jsonType: 'Array',
    constructor: Array,
    serialize: (data, transform) => {
      const len = data.length;
      const serialized = [];
      if (len === 0)
        return serialized;

      if (!transform.items)
        transform.items = { required:true, nullable:true };

      for (let i = 0; i < len; i++) {
        const value = data[i];
        if (value === null || value === undefined)
          serialized[i] = null;
        else if (typeof value === 'object')
          serialized[i] = serialize(value, transform.items);
        else {
          serialized[i] = value;
          if (transform.items.type === undefined)
            transform.items.type = 'primitive';
          else if (transform.items.type !== 'primitive')
            throw new TypeError('Type mismatch');
        }
      }

      return serialized;
    },
    normalize: (data, transform) => {
      const len = data.length;
      const itemType = typeMap.get(transform.items.type);
      if (itemType === undefined)
        throw new TypeError(`The '${transform.items.type}' type has not been added`);

      for (let i = 0; i < len; i++) {
        const value = data[i];
        if (value !== null)
          data[i] = itemType.normalize(value, transform.items);
      }

      return data;
    },
    codify: (varName, varAlias, transform, newVar) => {
      if (transform.items === undefined)
        return '';

      const numName = newVar();
      const incName = newVar();
      const subVarName = `${varAlias}[${incName}]`;

      return [
        `const ${numName} = ${varAlias}.length;`,
        `for (let ${incName} = 0; ${incName} < ${numName}; ${incName}++) {`,
          codify(subVarName, transform.items, newVar),
        `}`,
      ].join('');
    },
  },
  {
    name: 'Map',
    jsonType: 'Array',
    constructor: Map,
    /*
     * Similar to array serialization except only the map values are serialized.
     * Map keys are assumed to be primitives.
     */
    serialize: (data, transform) => {
      const len = data.size;
      const serialized = [ ...data ];
      if (len === 0)
        return serialized;

      if (!transform.items)
        transform.items = { required:true, nullable:true };

      for (let i = 0; i < len; i++) {
        const value = serialized[i][1];
        if (value === null || value === undefined)
          serialized[i][1] = null;
        else if (typeof value === 'object')
          serialized[i][1] = serialize(value, transform.items);
        else {
          serialized[i][1] = value;
          if (transform.items.type === undefined)
            transform.items.type = 'primitive';
          else if (transform.items.type !== 'primitive')
            throw new TypeError('Type mismatch');
        }
      }

      return serialized;
    },
    normalize: (data, transform) => {
      const len = data.length;

      if (transform.items) {
        const itemType = typeMap.get(transform.items.type);

        for (let i = 0; i < len; i++) {
          const value = data[i][1];
          if (value !== null)
            data[i][1] = itemType.normalize(value, transform.items);
        }
      }

      return new Map(data);
    },
    codify: (varName, varAlias, transform, newVar) => {
      const code = [];

      if (transform.items) {
        const numName = newVar();
        const incName = newVar();
        const subVarName = `${varAlias}[${incName}][1]`;

        code.push(
          `const ${numName} = ${varAlias}.length;`,
          `for (let ${incName} = 0; ${incName} < ${numName}; ${incName}++) {`,
            codify(subVarName, transform.items, newVar),
          `}`,
        );
      }

      code.push(`${varName} = new Map(${varAlias});`);

      return code.join('');
    },
  },
  {
    name: 'Set',
    jsonType: 'Array',
    constructor: Set,
    serialize: (data, transform) => {
      const type = typeMap.get(Array);

      return type.serialize([ ...data ], transform);
    },
    normalize: (data, transform) => {
      const len = data.length;

      if (transform.items) {
        const itemType = typeMap.get(transform.items.type);

        for (let i = 0; i < len; i++) {
          const value = data[i];
          if (value !== null)
            data[i] = itemType.normalize(value, transform.items);
        }
      }

      return new Set(data);
    },
    codify: (varName, varAlias, transform, newVar) => {
      const code = [];

      if (transform.items) {
        const numName = newVar();
        const incName = newVar();
        const subVarName = `${varAlias}[${incName}]`;

        code.push(
          `const ${numName} = ${varAlias}.length;`,
          `for (let ${incName} = 0; ${incName} < ${numName}; ${incName}++) {`,
            codify(subVarName, transform.items, newVar),
          `}`,
        );
      }

      code.push(`${varName} = new Set(${varAlias});`);

      return code.join();
    },
  },
  {
    name: 'Date',
    jsonType: 'String',
    constructor: Date,
    serialize: data => data.toISOString(),
    normalize: data => new Date(data),
    codify: (varName, varAlias) => `${varName} = new Date(${varAlias});`,
  },
];
const typeMap = new Map();
const constructors = {};
for (const type of types) {
  type.builtin = true;

  typeMap.set(type.name, type);
  typeMap.set(type.constructor, type);
}

/*
 * Determine if the data is a transformable type and serialize it.
 *
 * data must be typeof 'object'
 */
const serialize = (data, transform) => {
  if (!typeMap.has(data.constructor))
    throw new TypeError(`The '${data.constructor.name}' type has not been added`);
  const type = typeMap.get(data.constructor);

  if (transform.type === undefined)
    transform.type = type.name;
  else if (transform.type !== type.name)
    throw new TypeError('Type mismatch');

  // Only serialize if serialization is required before JSON.stringify()
  if (!type.schema)
    return type.serialize(data, transform);

  return data;
};
const codify = (varName, transform, newVar) => {
  if (transform.type.constructor === Array)
    return codifyUnion(varName, transform, newVar);

  const type = typeMap.get(transform.type);
  const varAlias = newVar();
  const varPlaceholder = `__${varAlias}__`;
  const code = codifyOptional(
    type.codify(varName, varPlaceholder, transform, newVar),
    varPlaceholder,
    transform,
  );

  const varMatch = new RegExp(varPlaceholder, 'g');
  const count = (code.match(varMatch) || []).length;
  if (count < 2)
    return code.replace(varMatch, varName);

  return [
    `const ${varAlias} = ${varName};`,
    code.replace(varMatch, varAlias),
  ].join('');
};
/*
 * Right now, only builtin types may be unioned.
 */
const codifyUnion = (varName, transform, newVar) => {
  const varAlias = newVar();
  const code = [
    `const ${varAlias} = ${varName};`,
  ];

  const typeNames = new Set(transform.type);
  typeNames.delete('primitive');

  if (typeNames.size > 1)
    code.push(`switch (${varAlias}.constructor) {`);

  for (const typeName of typeNames) {
    const type = typeMap.get(typeName);
    const typeCode = type.codify(varName, varAlias, transform, newVar);

    if (typeNames.size > 1)
      code.push(
        `case ${typeName}:`,
          typeCode,
          `break;`,
      );
    else
      code.push(
        `if (${varAlias}.constructor === ${typeName}) {`,
          typeCode,
        `}`,
      );
  }

  if (typeNames.size > 1)
    code.push('}');

  return codifyOptional(
    code.join(''),
    varAlias,
    transform,
  );
};

/*
 * Provide a serialize function to custom types that don't have one.
 * This constructs a transform when one was not provided.
 */
const serializeNOOP = data => data;
const serializeDefault = (data, transform) => {
  const serialized = data.toJSON();

  if (serialized === undefined || serialized === null)
    return null;
  else if (typeof serialized === 'object') {
    const type = typeMap.get(serialized.constructor);
    return type.serialize(serialized, transform);
  }

  return serialized;
};
/*
 * Provide a normalize function to custom types that don't have one.
 */
const normalizeNOOP = data => data;
const normalizeDefault = (data, transform) => {
  if (data === null)
    return data;

  const type = typeMap.get(transform.type);

  /*
   * Determine if the object or array requires normalization.
   */
  if (data.constructor === Object && transform.keys)
    typeMap.get(data.constructor).normalize(data, transform);
  else if (data.constructor === Array && transform.items)
    typeMap.get(data.constructor).normalize(data, transform);

  if (type.constructor.fromJSON)
    return type.constructor.fromJSON(data);
  else
    return new type.constructor(data);
};
const codifyDefault = (varName, varAlias, transform, newVar) => {
  const type = typeMap.get(transform.type);
  const jsonType = typeMap.get(type.jsonType);
  const construction = type.constructor.fromJSON
    ? `constructors.${transform.type}.fromJSON(${varAlias})`
    : `new constructors.${transform.type}(${varAlias})`;

  return [
    jsonType.codify(varName, varAlias, transform, newVar),
    `${varName} = ${construction};`,
  ].join('');
};
const codifyCompiled = (varName, varAlias, transform) => {
  const type = typeMap.get(transform.type);

  // Order matters.  __alias__ must be replaced before __name__ because varName
  // may contain __alias__.  This happens when one compiled type has another
  // compiled type as a property.
  return type.code.replace(/__alias__/g, varAlias).replace(/__name__/g, varName);
};

/*
 * Convert keys object notation to map notation.
 */
const normalizeTransform = transform => {
  if (transform.keys) {
    if (transform.keys.constructor === Object) {
      const keys = [];
      for (const [ key, keyTransform ] of Object.entries(transform.keys)) {
        keys.push([ key, normalizeTransform(keyTransform) ]);
      }
      transform.keys = keys;
    } else {
      const numKeys = transform.keys.length;
      for (let i = 0; i < numKeys; i++) {
        normalizeTransform(transform.keys[i][1]);
      }
    }
  }

  if (transform.items)
    normalizeTransform(transform.items);

  return transform;
};
const mergeSchemaTypes = (...types) => {
  const mergedTypes = new Set();
  for (const type of types) {
    if (type === undefined)
      continue;

    if (typeof type === 'string')
      mergedTypes.add(type);
    else if (type.constructor === Array)
      for (const typeItem of type) {
        mergedTypes.add(typeItem);
      }
    else
      throw new Error('Unable to interpret schema type');
  }

  if (mergedTypes.size === 0)
    return;
  else if (mergedTypes.size === 1)
    return [ ...mergedTypes ][0];
  return [ ...mergedTypes ];
};
const mergeSchemaProperties = (...propertySets) => {
  const mergedProperties = {};
  for (const properties of propertySets) {
    if (properties === undefined)
      continue;

    for (const [ key, keySchema ] of Object.entries(properties)) {
      if (key in mergedProperties)
        mergedProperties[key].type = mergeSchemaTypes(mergedProperties[key].type, keySchema.type);
      else
        mergedProperties[key] = keySchema;
    }
  }

  return mergedProperties;
};
const compileSchema = (schema, subSchema = schema, isRequired = true) => {
  if (subSchema.$ref) {
    const ref = subSchema.$ref;
    if (ref.startsWith('#/definitions/')) {
      subSchema = schema.definitions[ref.replace(/^#\/definitions\//, '')];
    } else {
      const type = typeMap.get(ref);
      if (!type)
        throw new Error(`The ${ref} type needs to be added before ${schema.$id}`);
      if (!type.schema)
        throw new Error(`The ${ref} type has no schema`);
      return { type:type.name, required:isRequired, nullable:false };
    }
  }

  if (subSchema.oneOf) {
    const mergeSchema = JSON.parse(JSON.stringify(subSchema));

    for (let one of subSchema.oneOf) {
      if (one.$ref) {
        const ref = one.$ref;
        if (ref.startsWith('#/definitions/')) {
          one = schema.definitions[ref.replace(/^#\/definitions\//, '')];
        } else {
          const type = typeMap.get(ref);
          if (!type)
            throw new Error(`The ${ref} type needs to be added before ${schema.$id}`);
          if (!type.schema)
            throw new Error(`The ${ref} type has no schema`);
          one = Object.assign({}, type.schema, { subType:type.name });
        }
      }

      mergeSchema.type = mergeSchemaTypes(mergeSchema.type, one.type);

      if (one.subType && one.subType !== mergeSchema.subType) {
        if (mergeSchema.subType)
          throw new Error('Unable to merge subType in oneOf');
        mergeSchema.subType = one.subType;
      }

      mergeSchema.properties = mergeSchemaProperties(mergeSchema.properties, one.properties);

      if (one.items) {
        if (mergeSchema.items)
          throw new Error('Unable to merge items in oneOf');
        mergeSchema.items = one.items;
        mergeSchema.additionalItems = one.additionalItems;
      }
    }

    subSchema = mergeSchema;
  }

  const types = new Set(subSchema.type.constructor === Array ? subSchema.type : [ subSchema.type ]);

  let schemaType;
  if (types.has('object') && types.has('array'))
    schemaType = [ 'Object', 'Array' ];
  else if (types.has('object'))
    schemaType = 'Object';
  else if (types.has('array'))
    schemaType = 'Array';
  else
    schemaType = 'primitive';

  const transform = {
    type: subSchema.$id ?? subSchema.subType ?? schemaType,
    required: isRequired,
    nullable: types.has('null'),
  };

  if (types.has('object')) {
    const required = new Set(subSchema.required ?? []);

    if (subSchema.properties) {
      transform.keys = new Map();
      for (const [ key, keySchema ] of Object.entries(subSchema.properties)) {
        transform.keys.set(key, compileSchema(schema, keySchema, required.has(key)));
      }
    }
  }

  if (types.has('array')) {
    if (subSchema.items) {
      if (subSchema.items.constructor === Array) {
        if (subSchema.additionalItems !== false)
          throw new Error('Unsupported additionalItems');

        transform.items = subSchema.items.map(i => compileSchema(schema, i));
      } else {
        if (transform.type === 'Map')
          transform.items = compileSchema(schema, subSchema.items.items[1]);
        else
          transform.items = compileSchema(schema, subSchema.items);
      }
    }
  }

  if (schema !== subSchema)
    return transform;
  return transform;
};
const compileTransform = (type, transform, suffix = '') => {
  const varName = '__name__';
  const varAlias = '__alias__';
  const jsonType = typeMap.get(type.jsonType);
  const construction = type.constructor.fromJSON
    ? `constructors.${transform.type}.fromJSON(${varAlias})`
    : `new constructors.${transform.type}(${varAlias})`;
  let varNew = '';

  const code = [];
  if (jsonType)
    code.push(jsonType.codify(varName, varAlias, transform, () => {
      if (varNew === '')
        varNew = 'a';
      else if (varNew.slice(-1) === 'z')
        varNew = varNew.slice(0, -1) + 'A';
      else if (varNew.slice(-1) === 'Z')
        varNew = varNew + 'a';
      else
        varNew = varNew.slice(0, -1) + String.fromCharCode(varNew.charCodeAt(varNew.length - 1) + 1);

      return varNew + suffix;
    }));

  code.push(`${varName} = ${construction};`);

  return code.join('');
};
const compileNormalize = code => {
  const normalize = new Function('data', 'constructors', [
    code.replace(/__name__/g, 'data').replace(/__alias__/g, 'data'),
    `return data;`,
  ].join(''));

  return data => normalize(data, constructors);
};
/*
 * Remove transforms that are empty of type transformations.
 * Return true if the transform is empty.
 */
const pruneTransform = (transform, forCode = false) => {
  const typeNames = new Set(
    transform.type.constructor === Array ? transform.type : [ transform.type ]
  );
  typeNames.delete('primitive');

  /*
   * 'required' and 'nullable' are only useful for code generation.
   */
  if (forCode === false) {
    delete transform.required;
    delete transform.nullable;
  }

  if (transform.items) {
    if (transform.items.constructor === Array) {
      if (transform.items.filter(i => !pruneTransform(i, forCode)).length === 0)
        delete transform.items;
    } else if (pruneTransform(transform.items, forCode))
      delete transform.items;
  }
  if (transform.items === undefined)
    typeNames.delete('Array');

  if (transform.keys) {
    for (const [ key, keyTransform ] of transform.keys) {
      if (pruneTransform(keyTransform, forCode))
        transform.keys.delete(key);
    }

    if (transform.keys.size === 0)
      delete transform.keys;
  }
  if (transform.keys === undefined)
    typeNames.delete('Object');

  if (typeNames.size === 0)
    return true;

  return Object.keys(transform).length === 0;
};
const codifyOptional = (code, varName, transform) => {
  if (transform.required && !transform.nullable)
    return code;

  const type = typeMap.get(transform.type);

  let check;
  if (type.jsonType === 'String')
    check = `typeof ${varName} === 'string'`;
  else if (!transform.required && transform.nullable)
    check = `${varName} !== undefined && ${varName} !== null`;
  else if (transform.nullable)
    check = `${varName} !== null`;
  else
    check = `${varName} !== undefined`;

  return `if (${check}) {${code}}`;
};

const serializer = {
  addType: type => {
    if (typeMap.has(type.name))
      throw new TypeError('Type name conflict');
    if (typeMap.has(type.constructor))
      throw new TypeError('Type constructor conflict');

    // A toJSON method is required to stringify an instance of this type.
    if (typeof type.constructor.prototype.toJSON !== 'function')
      throw new Error('A toJSON() method is required.');

    if (type.schema) {
      type.jsonType = type.schema.type.toUpperCase('first');

      const transform = compileSchema(type.schema);
      if (pruneTransform(transform, true)) {
        type.serialize = null;
        type.normalize = normalizeNOOP;
      } else {
        type.code = compileTransform(type, transform, types.length.toString());
        type.codify = codifyCompiled;
        type.serialize = null;
        type.normalize = compileNormalize(type.code);
      }
    } else {
      if (!type.jsonType)
        type.jsonType = 'Object';
      type.codify = codifyDefault;
      type.serialize = serializeDefault;
      type.normalize = normalizeDefault;
    }

    types.push(type);
    constructors[type.name] = type.constructor;
    typeMap.set(type.name, type);
    typeMap.set(type.constructor, type);
  },
  transform: data => {
    if (data === null || typeof data !== 'object')
      throw new TypeError('Unable to transform');

    const type = typeMap.get(data.constructor);
    if (type.schema)
      return { type:type.name, data };

    const transform = {};
    const serialized = serialize(data, transform);

    if (pruneTransform(transform))
      return { data:serialized };

    return { transform, data:serialized };
  },
  stringify: data => {
    return JSON.stringify(serializer.transform(data));
  },
  normalize: serialized => {
    if (serialized.type) {
      const type = typeMap.get(serialized.type);
      return type.normalize(serialized.data);
    } else if (serialized.transform) {
      const type = typeMap.get(serialized.transform.type);
      return type.normalize(serialized.data, serialized.transform);
    } else if (serialized.data)
      return serialized.data;

    throw new TypeError('Unable to normalize');
  },
  parse: json => {
    return serializer.normalize(JSON.parse(json));
  },
  clone: data => {
    return this.parse(this.stringify(data));
  },
};

export default serializer;
