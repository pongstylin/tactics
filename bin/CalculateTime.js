'use strict';
import fs from 'fs' 

var gameArg = process.argv[2];

calculateWinner(gameArg);

//Calculates the winner given a game Id
function calculateWinner(gameId){
    let contents = loadGameFileContents(gameId);
    let [player1Time, player2Time] = calculateMoveTime(contents);
    let teams = contents.state.teams;
    let player1 = teams.filter(team => team.id == 0);
    let player2 = teams.filter(team => team.id == 1);
    console.log( player1[0].name + " took " + player1Time);
    console.log( player2[0].name + " took " + player2Time);
    if (player1Time > player2Time){
        console.log("Winner is " + player2[0].name);
        console.log("Player ID is " + player2[0].playerId)

    }
    else if (player2Time > player1Time){
        console.log("Winner is " + player1[0].name);
        console.log("Player ID is " + player1[0].playerId)
    }
    else {
        console.log("Wooooooow it's a draw?!?!?!")
    }
    

}

//Reads and returns Game file
function loadGameFileContents(gameId){

    let rawContents = fs.readFileSync('./src/data/files/game_'+ gameId +'.json');
    let gameContents = JSON.parse(rawContents);
    return gameContents;

}

//Returns an array of the total time it took two teams to make a move [Team1Time, Team2Time]
function calculateMoveTime(contents){

    let turns = contents.state.turns;
    let playerTimes = turns.map(function(turn, index) {
        if (turns.length > index + 1){
           let nextTurnTime = turns[ index + 1 ].started;
           return new Date(nextTurnTime) - new Date(turn.started)
        }
        else { return new Date(contents.state.turnStarted) - new Date(turn.started)}
    //Reduce to an array of values lets us only iterate over the map once.  Sacrifices readibility for speed.    
    }).reduce(function(acc, val, index){
        if (index % 2 == 0) {
            if (index == 0){
                acc.push(val)
                acc.push(0)
            }
            else {
                acc[0] += val;
            }
        }
        else {
            acc[1] += val;
        }
        return acc;
    },[]);

    //Need to add the time between last turn ending and current turn, can't be done in the iterators above
    let lastTurn = (turns.length) % 2; //length - 1 would tell us who made the last turn, turns.length gives us the next turn
    playerTimes[lastTurn] += new Date() - new Date(contents.state.turnStarted);
    return playerTimes;

}
