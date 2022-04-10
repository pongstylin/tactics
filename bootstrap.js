import Timeout from 'server/Timeout.js';
import serializer from 'utils/serializer.js';
import FileAdapter from 'data/FileAdapter.js';

import 'tactics/GameType.js';
import {RedisAdapter, redisDB} from 'data/redisAdapter.js';

export default class bootstrapper extends RedisAdapter {
    files = new FileAdapter({
      name: 'game'});
    constructor() {
      super({name:'bootstrap'});
      this.init();
    }
init = async ()=>{
    const gameTypes = await this._gameTypes();
    const timeout = await this._timeout();
     
      await redisDB.set("gametypes",'.',serializer.transform(gameTypes));
      await redisDB.set("timeouts",'.',serializer.transform(timeout));
    
    console.log("timeouts and gametypes have been successfully loaded!");
    process.exit();
    
}
  _gameTypes = async ()=>{ return this.files.getFile('game_types', data => {
    const gameTypes = new Map();

   
    for (const [ id, config ] of data) {
      
      gameTypes.set(id, serializer.normalize({
        $type: 'GameType',
        $data: { id, config },
      }));
    }
 
    return gameTypes;
  });
};
_timeout = async () => { return this.files.getFile(`timeout/autoSurrender`, data => {
  if (data === undefined)
    return {
      timeout: new Timeout(`${this.name}AutoSurrender`),
      shutdownAt: new Date(),
    };
  else
    return serializer.normalize(data);
});
};
}
new bootstrapper();