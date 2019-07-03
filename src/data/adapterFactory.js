'use strict';

import FileAdapter from 'data/FileAdapter.js';
// Not yet ready for prime time.
//import MySqlAdapter from 'data/MySqlAdapter.js';

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
