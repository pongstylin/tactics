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
   
     
      await redisDB.set("gametypes", JSON.stringify(gameTypes));
      await redisDB.set("timeouts",JSON.stringify({
        timeout: new Timeout(`${this.name}AutoSurrender`),
        shutdownAt: new Date(),
      }));
    
    console.log("timeouts and gametypes have been successfully loaded!");
    process.exit();
    
}
  _gameTypes = async ()=>{ return this.files.getFile('game_types', data => {
   return data;
  });
};
}
new bootstrapper();