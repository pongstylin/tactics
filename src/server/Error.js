/*
 * Most classes in the 'server' directory are only used on the server.
 * But this class is the exception.
 */
import serializer from '#utils/serializer.js';

export default class ServerError extends Error {
  constructor() {
    let data;
    if (arguments.length === 1)
      data = arguments[0];
    else if (arguments.length === 2)
      data = { code:arguments[0], message:arguments[1] };

    super(data.message);

    this.message = data.message;
    Object.assign(this, data);
  }

  toJSON() {
    const json = { message:this.message };
    Object.keys(this).forEach(k => json[k] = this[k]);

    return json;
  }
};

serializer.addType({
  name: 'ServerError',
  constructor: ServerError,
  schema: {
    type: 'object',
    required: [ 'code', 'message' ],
    properties: {
      code: { type:'number' },
      message: { type:'string' },
    },
    additionalProperties: true,
  },
});
