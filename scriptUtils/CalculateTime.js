'use strict';
import fs from 'fs' 

var gameArg = process.argv[2];


calculateWinner(gameArg);

function calculateWinner(gameId){
    let contents = loadGameFileContents(gameId);
    let [player1Time, player2Time] = calculateMoveTime(contents);
    let teams = contents.state.teams;
    let player1 = teams.filter(team => team.id == 0);
    let player2 = teams.filter(team => team.id == 1);
    if (player1Time > player2Time){
        console.log("Winner is " + player2[0].name);
        console.log("Player ID is " + player2[0].playerId)
    }
    else if (player2Time > player2Time){
        console.log("Winner is " + player1[0].name);
        console.log("Player ID is " + player2[0].playerId)
    }
    else {
        console.log("Wooooooow it's a draw?!?!?!")
    }
    

}

function loadGameFileContents(gameId){

    let rawContents = fs.readFileSync('../src/data/files/game_'+ gameId +'.json');
    let gameContents = JSON.parse(rawContents);
    return gameContents;

}

function calculateMoveTime(contents){

    let turns = contents.state.turns;
    let [ player1Time , player2Time ] = turns.map(function(turn, index) {
        if (turns.length > index + 1){
           let nextTurnTime = turns[ index + 1 ].started;
           return new Date(nextTurnTime) - new Date(turn.started)
        }
        else { return new Date(contents.state.turnStarted) - new Date(turn.started)}
        
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
    //let player2Turns = turns.filter((turn, index) => index % 2 != 0);
    return [player1Time,player2Time];


}
//790aa290-0840-41c3-b5d4-f7e631e0c91c