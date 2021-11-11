import serializer from 'utils/serializer.js';

export default class Version {
  major: number
  minor: number
  revision: number
  value: string

  constructor(version) {
    const parts = version.split('.').map(n => parseInt(n));

    this.major = parts[0];
    this.minor = parts[1];
    this.revision = parts[2];
    this.value = version;
  }

  /*
   * Test to see if two versions are compatible with each other.
   *
   * In other words, a client and server are compatible if they have the same
   * version or a compatible version.  Different versions are only compatible if
   * they share the same major and minor version.
   */
  isCompatibleWith(version) {
    if (typeof version === 'string')
      version = new Version(version);

    return this.major === version.major && this.minor === version.minor;
  }

  toString() {
    return this.value;
  }

  toJSON() {
    return this.value;
  }
};

serializer.addType({
  name: 'Version',
  constructor: Version,
  schema: {
    $schema: 'http://json-schema.org/draft-07/schema',
    $id: 'Version',
    type: 'string',
  },
});
