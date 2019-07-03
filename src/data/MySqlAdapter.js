'use strict';

import Player from 'models/Player.js';
import Game from 'models/Game.js';
import mysql from 'mysql';
import bcrypt from 'bcrypt';

export default class {

  constructor(){

    let dbConfig =  {
        host: process.env.DATABASE_HOST,
        user: process.env.DATABASE_USER,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME
    };

    this.connection = mysql.createConnection(dbConfig);
    this.connection.connect(function(err){
        if(!err) {
            console.log("Database is connected ... ");    
        } else {
            console.log(err);    
        }
    });
  }

  //promise wrapper for mysql query
  query( sql, args ) {
    return new Promise( ( resolve, reject ) => {
        this.connection.query( sql, args, ( err, result ) => {
            if ( err ){
              console.log(err);
              return reject( err );
            }
            resolve( result );
        } );
    } );
  }

  //promise wrapper for mysql close
  close() {
    return new Promise( ( resolve, reject ) => {
        this.connection.end( err => {
            if ( err ){
                console.log(err);
                return reject( err );
            }
            resolve();
        } );
    } );
  }

  async getPlayerByEmail(email){
    let selectQuery = "select * from player where email = ? "
    return this.query(selectQuery, [email]).then( rows => {
      if (rows.length){
          return rows[0];         
      } else {
          console.log('[mysqladapter] no results found for email');
          return null;
      }
    }, err =>{
       console.log(err);
       return null;
    })
  }

  async getPlayerByUsername(username){
    let selectQuery = "select * from player where username = ? "
    return this.query(selectQuery, [username]).then( rows => {
      if (rows.length){
          return rows[0];         
      } else {
          console.log('[mysqladapter] no results found for username');
          return null;
      }
    }, err =>{
       return null;
    })
  }

  async createPlayer(playerData){
        let passwordHash = bcrypt.hashSync(playerData.password, 10);
        let insertQuery = "INSERT INTO player ( username, email, password, active ) values ( ?, ?, ?, ?)";
        return this.query(insertQuery, [playerData.username, playerData.email, passwordHash, 1]).then( result => {
           return result.insertId;         
        }, err =>{
           return 0;
        })
  }

  getConnection(){
    return this.connection;
  }

  //TODO: Implement
  savePlayer(player) {
    //this._writeFile(`player_${player.id}`, player);
  }

  //TODO: Implement
  getPlayer(playerId) {
    //let playerData = this._readFile(`player_${playerId}`);
    //return Player.load(playerData);
  }

  createGame(stateData) {
    let insertQuery = "INSERT INTO game ( name, created_by) values ( ?, ? )";
    return this.query(insertQuery, [stateData.name, stateData.createdBy]).then( result => {
        //create game object with new game id and save to database
       let gameId = result.insertId;
       stateData.id = gameId;
       let game = Game.create(stateData);
       return this.saveGame(game).then( res =>{
         return gameId;
       }, err => { return 0; })         
    }, err =>{
       return 0;
    })
  }

  saveGame(game) {
    let jsonData = JSON.stringify(game);
    let updateQuery = "update game set json_data = ? where id = ?";
    return this.query(updateQuery, [jsonData, game.id]).then( result => {
       return game.id;         
    }, err =>{
       return 0;
    })
  }

  setGameActive(game, playerId){
    let updateQuery = "update game set joined_by = ?, active = 1 where id = ?";
    return this.query(updateQuery, [playerId, game.id]).then( result => {
       return 1;         
    }, err =>{
       return 0;
    }) 
  }

  getGame(gameId) {
    let selectQuery = "select json_data from game where id = ? "
    return this.query(selectQuery, [gameId]).then( rows => {
      if (rows.length){
          let gameObj = JSON.parse(rows[0].json_data);
          return Game.load(gameObj);         
      } else {
          console.log('[mysqladapter] no results found for game');
          return null;
      }
    }, err =>{
       return null;
    })
  }

};
