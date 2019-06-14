'use strict';
/*
 * Ultimately, this factory needs to return the appropriate adapter based on
 * environment settings.
 */
import FileAdapter from 'data/FileAdapter.js';
import MySqlAdapter from 'data/MySqlAdapter.js';

export default () => {
  let adapterType =  process.env.ADAPTER_TYPE;
  switch(adapterType){
    case 'mysql':
      return new MySqlAdapter();
    
    case 'file':
      return new FileAdapter();

    default:
      return new FileAdapter();
  }
};
