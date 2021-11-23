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
      const serialized = new Array(len);
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

      const code = [];

      if (transform.items.constructor === Array) {
        for (let i = 0; i < transform.items.length; i++) {
          if (transform.items[i].type === undefined)
            continue;

          const subVarName = `${varAlias}[${i}]`;

          code.push(codify(subVarName, transform.items[i], newVar));
        }
      } else {
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

      return code.join('');
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
      const len = data.size;
      const serialized = [ ...data ];
      if (len === 0)
        return serialized;

      if (!transform.items)
        transform.items = { required:true, nullable:true };

      for (let i = 0; i < len; i++) {
        const value = serialized[i];
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
const schemas = new Map();

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
    throw new TypeError(`Type conflict: ${transform.type} & ${type.name}`);

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
const makeSchema = definition => {
  return Object.assign({
    $schema: 'http://json-schema.org/draft-07/schema',
  }, makeSubSchema(normalizeDefinition(definition)));
};
const makeSubSchema = definition => {
  const subSchema = {};

  if (typeMap.has(definition.$type)) {
    const type = typeMap.get(definition.$type);

    if (type.builtin) {
      if (definition.$validation)
        throw new TypeError('May not use $validation with built-in types');

      subSchema.type = type.jsonType.toLowerCase();
      subSchema.subType = type.name;
    } else {
      subSchema.$ref = type.schema.$id;
      subSchema.subType = type.name;
      if (definition.$validation)
        subSchema.validation = definition.$validation;

      return subSchema;
    }
  } else if (schemas.has(definition.$type))
    return { $ref:definition.$type };
  else if (definition.$type.constructor === Array)
    return { oneOf:definition.$type.map(t => makeSubSchema(normalizeDefinition(t))) };
  else
    subSchema.type = definition.$type;

  switch (subSchema.type) {
    case 'object':
      if (definition.$properties) {
        subSchema.required = [];
        subSchema.properties = {};
        subSchema.additionalProperties = false;

        const keys = Object.keys(definition.$properties);
        for (const key of keys) {
          const propertyName = key.replace(/\?$/, '');
          const keyDefinition = normalizeDefinition(definition.$properties[key]);

          if (propertyName === key && keyDefinition.$required !== false)
            subSchema.required.push(propertyName);
          subSchema.properties[propertyName] = makeSubSchema(keyDefinition);
        }
      }
      break;
    case 'array':
      if (definition.$items) {
        if (definition.$items.constructor === Array) {
          subSchema.minItems = definition.$minItems;
          subSchema.items = [];
          subSchema.additionalItems = false;

          for (let i = 0; i < definition.$items.length; i++) {
            const itemDefinition = normalizeDefinition(definition.$items[i]);

            if (itemDefinition.$required === false) {
              if (subSchema.minItems === undefined)
                subSchema.minItems = i;
            } else {
              if (subSchema.minItems > i)
                throw new TypeError('Unsupported non-right-aligned optional items in tuple');
            }

            subSchema.items.push(makeSubSchema(itemDefinition));
          }

          if (subSchema.minItems === undefined)
            subSchema.minItems = subSchema.items.length;
        } else
          subSchema.items = makeSubSchema(normalizeDefinition(definition.$items));
      }
      break;
    case 'string':
      if (definition.$const)
        subSchema.const = definition.$const;
      if (definition.$enum)
        subSchema.enum = definition.$enum;
      if (definition.$regexp)
        subSchema.regexp = definition.$regexp;
      if (definition.$minLength)
        subSchema.minLength = definition.$minLength;
      if (definition.$maxLength)
        subSchema.maxLength = definition.$maxLength;
      break;
    case 'number':
    case 'integer':
      if (definition.$minimum !== undefined)
        subSchema.minimum = definition.$minimum;
      if (definition.$maximum !== undefined)
        subSchema.maximum = definition.$maximum;
      break;
    default:
      throw new TypeError(`Unsupported type: ${subSchema.type}`);
  }

  return subSchema;
};
const getPrimitiveTypeOfValue = value => {
  if (value === null)
    return 'null';
  else if (typeof value === 'object')
    throw new Error(`Unexpected object or array`);
  else
    return typeof value;
};
const normalizeDefinition = definition => {
  if (typeof definition === 'string') {
    const types = definition.split(/\s*\|\s*/);

    for (let i = 0; i < types.length; i++) {
      const def = { $type:types[i] };

      if (def.$type.endsWith('?')) {
        def.$type = def.$type.slice(0, -1);
        def.$required = false;
      }
      if (def.$type.endsWith('[]')) {
        def.$type = def.$type.slice(0, -2);
        types[i] = {
          $type: 'array',
          $items: def,
        };
        if (def.$required !== undefined) {
          types[i].$required = def.$required;
          delete def.$required;
        }
      } else {
        types[i] = def;
      }

      const matchParams = def.$type.match(/^(.+?)\((.*)\)$/);
      if (matchParams) {
        const type = matchParams[1];
        const args = [];

        try {
          args.push(...new Function(`'use strict';return [${matchParams[2]}]`)());
        } catch(e) {
          throw new Error(`Invalid syntax: ${matchParams[2]}`);
        }

        switch (type) {
          case 'number':
          case 'integer':
            def.$type = type;
            if (args.length === 2) {
              def.$minimum = args[0];
              def.$maximum = args[1];
            } else if (args.length === 1)
              def.$minimum = args[0];
            break;
          case 'string':
            def.$type = type;
            if (args.length === 1) {
              if (typeof args[0] === 'number')
                def.$minLength = args[0];
              else if (args[0] instanceof RegExp)
                def.$regexp = args[0].toString();
            } else if (args.length === 2) {
              def.$minLength = args[0];
              def.$maxLength = args[1];
            }
            break;
          case 'const':
            def.$type = getPrimitiveTypeOfValue(args[0]);
            def.$const = args[0];
            break;
          case 'enum':
            if (args[0]?.constructor !== Array)
              throw new Error(`'enum' expects an array of values`);
            if (args[0].length === 0)
              throw new Error(`'enum' requires at least one value`);
            if (new Set(args[0]).size < args[0].length)
              throw new Error(`'enum' values must be unique`);

            const types = [ ...new Set(args[0].map(v => getPrimitiveTypeOfValue(v))) ];
            def.$type = types.length === 1 ? types[0] : types;
            def.$enum = args[0];
            break;
          default:
            throw new Error(`Parameters are not supported for '${type}'`);
        }
      }
    }

    if (types.length > 1) {
      let isRequired;
      for (let i = 0; i < types.length; i++) {
        if (types[i].$required === false) {
          if (isRequired === true)
            throw new TypeError('All types in a union must be optional or not');
          isRequired = false;
          delete types[i].$required;
        } else {
          if (isRequired === false)
            throw new TypeError('All types in a union must be optional or not');
          isRequired = true;
        }
      }

      if (isRequired === false)
        return { $type:types, $required:false };
      return { $type:types };
    }

    return types[0];
  } else if (typeof definition === 'object') {
    if (definition.constructor === Object) {
      if (definition.$type)
        return definition;
      else
        return {
          $type: 'object',
          $properties: definition,
        };
    } else if (definition.constructor === Array)
      return {
        $type: 'array',
        $items: definition,
      };
  } else if (typeof definition === 'function') {
    const type = typeMap.get(definition);
    if (!type)
      throw new TypeError(`Unrecognized type: ${definition.name}`);

    return { $type:type.name };
  }

  throw new TypeError(`Invalid type: ${typeof definition}`);
};
const compileSchema = (schema, subSchema = schema, isRequired = true) => {
  if (subSchema.$ref) {
    const ref = subSchema.$ref;
    if (ref.startsWith('#/definitions/')) {
      subSchema = schema.definitions[ref.replace(/^#\/definitions\//, '')];
    } else if (schemas.has(ref)) {
      subSchema = schemas.get(ref);
    } else if (typeMap.has(ref)) {
      const type = typeMap.get(ref);
      if (!type.schema)
        throw new Error(`The ${ref} type has no schema`);
      return { type:type.name, required:isRequired, nullable:false };
    } else
      throw new Error(`The ${ref} schema needs to be added before ${schema.$id}`);
  }

  if (typeof subSchema.$id === 'string' && subSchema.$id.startsWith('type:'))
    subSchema = Object.assign({}, subSchema, { subType:subSchema.$id.replace(/^type:/, '') });

  if (subSchema.oneOf) {
    const mergeSchema = JSON.parse(JSON.stringify(subSchema));

    for (let one of subSchema.oneOf) {
      if (one.$ref) {
        const ref = one.$ref;
        if (ref.startsWith('#/definitions/')) {
          one = schema.definitions[ref.replace(/^#\/definitions\//, '')];
        } else if (schemas.has(ref)) {
          one = schemas.get(ref);
        } else if (typeMap.has(ref)) {
          const type = typeMap.get(ref);
          if (!type.schema)
            throw new Error(`The ${ref} type has no schema`);
          one = Object.assign({}, type.schema, { subType:type.name });
        } else
          throw new Error(`The ${ref} schema needs to be added before ${schema.$id}`);
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
    type: subSchema.subType ?? schemaType,
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

        const minItems = subSchema.minItems ?? 0;
        transform.items = subSchema.items.map((item, i) => compileSchema(schema, item, i < minItems));
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
const compileTypeTransform = (type, transform, suffix = '') => {
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
const compileTransform = transform => {
  if (pruneTransform(transform, true))
    return '';

  const varName = '__name__';
  const varAlias = '__alias__';
  const type = typeMap.get(transform.type);
  let varNew = '';

  return type.codify(varName, varAlias, transform, () => {
    if (varNew === '')
      varNew = 'a';
    else if (varNew.slice(-1) === 'z')
      varNew = varNew.slice(0, -1) + 'A';
    else if (varNew.slice(-1) === 'Z')
      varNew = varNew + 'a';
    else
      varNew = varNew.slice(0, -1) + String.fromCharCode(varNew.charCodeAt(varNew.length - 1) + 1);

    return varNew;
  });
};
const compileNormalize = code => {
  const normalize = new Function('data', 'constructors', [
    `'use strict';`,
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
  ajv: null,

  addType(type) {
    if (typeMap.has(type.name))
      throw new TypeError('Type name conflict');
    if (typeMap.has(type.constructor))
      throw new TypeError('Type constructor conflict');

    // A toJSON method is required to stringify an instance of this type.
    if (typeof type.constructor.prototype.toJSON !== 'function')
      throw new Error('A toJSON() method is required.');

    if (type.schema) {
      type.schema.$id = `type:${type.name}`;
      type.jsonType = type.schema.type.toUpperCase('first');

      // Add validation and resolution of type schemas.
      if (this.ajv)
        this.ajv.addSchema(type.schema);

      const transform = compileSchema(type.schema);
      if (pruneTransform(transform, true)) {
        type.serialize = null;
        type.normalize = normalizeNOOP;
      } else {
        type.code = compileTypeTransform(type, transform, types.length.toString());
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
    if (type.schema)
      typeMap.set(type.schema.$id, type);
  },
  transform(data) {
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
  stringify(data) {
    return JSON.stringify(serializer.transform(data));
  },
  normalize(serialized) {
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
  parse(json) {
    return serializer.normalize(JSON.parse(json));
  },
  addSchema(id, schema) {
    if (!/^[a-z]/.test(id))
      throw new Error('Schema $id must start with a lowercase letter');
    if (id.startsWith('type:'))
      throw new Error(`Schema $id must not start with 'type:'`);
    if (schemas.has(id))
      throw new Error(`Schema $id conflict: ${schema.$id}`);

    if (!schema.constructor === Object || !schema.$schema)
      schema = makeSchema(schema);

    schema.$id = id;
    schemas.set(id, schema);

    if (this.ajv)
      this.ajv.addSchema(schema);
  },
  enableValidation(newAjv) {
    const ajv = this.ajv = newAjv;

    ajv.addKeyword({
      keyword: 'subType',
      schemaType: 'string',
      implements: [ 'validation' ],
      validate: (subType, data, parentSchema) => {
        const type = typeMap.get(subType);
        if (typeof type.constructor.validate === 'function')
          type.constructor.validate(data, parentSchema.validation);

        return true;
      },
    });

    for (const type of types) {
      if (type.schema)
        ajv.addSchema(type.schema);
    }

    for (const schema of schemas.values()) {
      ajv.addSchema(schema);
    }
  },
  makeValidator(id, schema) {
    if (!schema.constructor === Object || !schema.$schema)
      schema = makeSchema(schema);

    schema.$id = id;

    const normalize = compileNormalize(compileTransform(compileSchema(schema)));
    const validate = this.ajv.compile(schema);

    return data => {
      if (!validate(data))
        throw validate.errors;

      return normalize(data);
    };
  },
  clone(data) {
    return this.parse(this.stringify(data));
  },
};

export default serializer;
