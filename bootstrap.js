
import serializer from 'utils/serializer.js';
import FileAdapter from 'data/FileAdapter.js';
import {RedisAdapter, redisDB} from 'data/redisAdapter.js';

export default class bootstrapper extends RedisAdapter {
    files = new FileAdapter({
      name: 'game'});
    constructor() {
      super({name:'bootstrap'});
      this.init();
    }
init = ()=>{
    const gameTypes = this._gameTypes();
    
      
      redisDB.set("gametypes",gameTypes);

  
    
}
  _gameTypes = async ()=>{ return this.files.getFile('game_types', data => {
   console.log(data);
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
}
new bootstrapper();