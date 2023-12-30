import serializer from '#utils/serializer.js';

export default class Version {
  major: number
  minor: number
  revision: number
  protected data: string

  constructor(data) {
    const parts = data.split('.').map(n => parseInt(n));

    this.major = parts[0];
    this.minor = parts[1];
    this.revision = parts[2];
    this.data = data;
  }

  /*
   * Test to see if two versions are compatible with each other.
   *
   * In other words, a client and server are compatible if they have the same
   * version or a compatible version.  Different versions are only compatible if
   * they share the same major and minor version.
   */
  isCompatibleWith(version) {
    if (version === null)
      return false;
    if (typeof version === 'string')
      version = new Version(version);

    return this.major === version.major && this.minor === version.minor;
  }

  toString() {
    return this.data;
  }

  toJSON() {
    return this.data;
  }
};

serializer.addType({
  name: 'Version',
  constructor: Version,
  schema: {
    type: 'string',
  },
});
