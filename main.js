var fs = require('fs');
var https = require('https');
var api_key = fs.readFileSync('api_key.txt', 'utf8');

var playerList;


https.get('https://euw.api.pvp.net/api/lol/euw/v2.5/league/challenger?type=RANKED_SOLO_5x5&api_key='+api_key, function(res) {
    var body="";
    console.log("Riot API Response Code: " + res.statusCode);
    res.on('data', function (chunk) {
        body+=chunk;
    });
    res.on('end', function (){            
        playerList = JSON.parse(body);
        for(var i=0;i<playerList.entries.length;i++){
            //setTimeout(check,0,i);
            check(i);
        }
    });
}).on('error', function(e) {
  console.error(e);
});


var responses=0;
var rateErrorCount=0;

var last429=0;
var lastReq=0;

//restrictions:
//after recieving 429, don't send anymore requests in the next 3 seconds
//waits at least 800ms between requests
function check(i){
    if(new Date().getTime()-last429<=1000 || new Date().getTime()-lastReq<=1000){
        setTimeout(check,1000+Math.random()*10000,i);
        return;
    }

    lastReq = new Date().getTime();
    https.get('https://euw.api.pvp.net/observer-mode/rest/consumer/getSpectatorGameInfo/EUW1/'+playerList.entries[i].playerOrTeamId+'?api_key='+api_key, function(res) { 
        //console.log(res.statusCode);      
        switch(res.statusCode){
            case 404:
                responses++;
                //console.log("404 Not Found"); 
                console.log(responses+ ".\tNo\t" + playerList.entries[i].playerOrTeamName);
                break
            case 429:
                rateErrorCount++;
                last429 = new Date().getTime();
                setTimeout(check,1000+Math.random()*10000,i);
                break;
            case 403: 
                //setTimeout(check,Math.random()*20000,i);
                break;
            case 200:
                responses++;
                //console.log("200 Success"); 
                console.log(responses + ".\tYes\t" + playerList.entries[i].playerOrTeamName);
                //console.log(playerList.entries[i].playerOrTeamName + "\t " + playerList.entries[i].leaguePoints);
                break;
            default:
                console.log(res.statusCode);
        }


    }).on('error', function(e) {
        console.error(e);
    });
}

var last=0;
rateCheck();
function rateCheck(){
    if(responses!=200){
        setTimeout(rateCheck,20000);
    }

    if(rateErrorCount!=last)
        console.log(rateErrorCount + " Rate Errors");
    
}
