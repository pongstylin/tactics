/*
 * Most classes in the 'server' directory are only used on the server.
 * But this class is the exception.
 */
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
    let json = { message:this.message };
    Object.keys(this).forEach(k => json[k] = this[k]);

    return json;
  }
}
