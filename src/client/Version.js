export default class Version {
  constructor(version) {
    let parts = version.split('.').map(n => parseInt(n));

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
}
