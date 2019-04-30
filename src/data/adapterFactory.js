'use strict';
/*
 * Ultimately, this factory needs to return the appropriate adapter based on
 * environment settings.
 */
import FileAdapter from 'data/FileAdapter.js';

export default () => {
  return new FileAdapter();
};
