//continous updating of the current games + player database

//Task A (every hour)
//1. get challenger list from riot
//2. commit to database

//Task B
//1. Get id of challenger player to check (from db)
//2. send current game query to riot
//3. update database (both player + game)

//Task C
//1. query riot about current games
//2. remove if finished

var fs = require('fs');
var https = require('https');
var api_key = fs.readFileSync('api_key.txt', 'utf8');

var playerList;

var MongoClient = require('mongodb').MongoClient;
var assert = require('assert');

//check player by id
function checkPlayer(id){
	https.get('https://euw.api.pvp.net/observer-mode/rest/consumer/getSpectatorGameInfo/EUW1/'+id+'?api_key='+api_key, function(res) { 
        var body="";
        res.on('data', function (chunk) {
            body+=chunk;
        });
        res.on('end', function (){            
            if(res.statusCode==200){
                var obj = JSON.parse(body);
                //obj.gameStartTimeDate = new Date(obj.gameStartTime);
                
                /* EXTRA GAME PROCESSING HERE (before db)*/
                if(obj.participants.length==10){
                    formulateTeam(obj);
                }

                addRanks(obj, function(){
                    MongoClient.connect('mongodb://localhost:27017/ss', function(err, db) {
                        var col = db.collection("games");
                        col.updateOne({'gameId':obj.gameId},obj, {upsert:true},function(err, result) {
                            db.close();
                        });
                    });
                });        
                
            }

            if(res.statusCode==404 || res.statusCode==200)
                 taskB();
        });      

        switch(res.statusCode){
        	case 200:
                console.log(id + " \tYes");
                break;
            case 404: 
                console.log(id+ " \tNo");
                break
            case 429:
                
                var retryAfter = res.headers["retry-after"];
                console.log("429 Rate Limit, wait",retryAfter,"seconds");
                setTimeout(function(){
                    checkPlayer(id);
                },retryAfter*1000);
                break;
            case 403: 
                console.log("403");
                break;
            
            default:
                console.log(res.statusCode);
        }


    }).on('error', function(e) {
        console.error(e);
    });

}

//taskA();
taskB();

//TASK B
function taskB(){
	//console.log("[B]Executing");
	MongoClient.connect('mongodb://localhost:27017/ss', function(err, db) {
		var col = db.collection('players');
		col.findOneAndUpdate({},{$set: {gameCheckTime:new Date()}}, {sort:{gameCheckTime:1}}, function(err, r) {
	      	//console.log(r.value.playerOrTeamName);
	      	checkPlayer(r.value.playerOrTeamId);       
            db.close();	        
	    });
	});
}


//TASK A
function taskA(){
	console.log("[A]Executing");
	https.get('https://euw.api.pvp.net/api/lol/euw/v2.5/league/challenger?type=RANKED_SOLO_5x5&api_key='+api_key, function(res) {
	    var body="";
	    console.log("[A]Riot API Response Code: " + res.statusCode);
	    res.on('data', function (chunk) {
	        body+=chunk;
	    });
	    res.on('end', function (){ 
	    	if(res.statusCode==200){
                var obj = JSON.parse(body);

                MongoClient.connect('mongodb://localhost:27017/ss', function(err, db) {
                    var col = db.collection("players");

                    var awaiting=0;
                    for(var i=0;i<obj.entries.length;i++){
                    	awaiting++;
                    	col.updateOne({'playerOrTeamId':obj.entries[i].playerOrTeamId},obj.entries[i], {upsert:true},function(err,result){
                    		awaiting--;
                    		//console.log(awaiting);
                    		if(err!=null)
                    			console.log(err);
                    		if(awaiting==0){
                    			 db.close();
                    			 console.log("[A]Completed");
                    			 //setTimeout(taskA,10000);
                    		}
                    	});
                    }                      

                });
            }	

	    });
	});
}

var roleName = ["Top","Jungle","Mid","ADC","Support"];
var baseElo = {"BRONZE":800,"SILVER":1150,"GOLD":1500,"PLATINUM":1850,"DIAMOND":2200,"MASTER":2550,"CHALLENGER":2550};
var divConvert = {"I":4,"II":3,"III":2,"IV":1,"V":0};

function addRanks(g,callback){
    var p = g.participants;
    var s="";
    for(var i=0;i<p.length;i++)
        s+=p[i].summonerId+",";

    https.get('https://euw.api.pvp.net/api/lol/euw/v2.5/league/by-summoner/'+s+'/entry?api_key='+api_key, function(res) { 
        var body="";
        res.on('data', function (chunk) {
            body+=chunk;
        });
        res.on('end', function (){            
            if(res.statusCode==200){
                var resobj = JSON.parse(body);
                //console.log(resobj);

                g.allRanked=true;
                g.avgElo=0;
                for(var i=0;i<p.length;i++){
                    p[i].ranked = false;
                    for(var j=0;resobj[p[i].summonerId]!=undefined && j<resobj[p[i].summonerId].length;j++){
                        if(resobj[p[i].summonerId][j].queue=="RANKED_SOLO_5x5"){
                            p[i].ranked = true;
                            p[i].tier = resobj[p[i].summonerId][j].tier;
                            p[i].division = resobj[p[i].summonerId][j].entries[0].division;
                            p[i].leaguePoints = resobj[p[i].summonerId][j].entries[0].leaguePoints;    
                            
                            if(p[i].tier=="MASTER" || p[i].tier=="CHALLENGER")
                                p[i].elo = Math.floor( baseElo[p[i].tier] + (70/100)*p[i].leaguePoints );
                            else
                                p[i].elo = Math.floor( baseElo[p[i].tier] + 70*divConvert[p[i].division] + (70/100)*p[i].leaguePoints );

                            g.avgElo += p[i].elo/p.length;
                            //console.log(p[i].tier + " " + p[i].division + " " + p[i].leaguePoints + "LP");
                        }
                    }
                    if(!p[i].ranked)
                      g.allRanked=false;
                }
                g.avgElo = Math.floor(g.avgElo);
                callback();
            }
        });
        switch(res.statusCode){
            case 200:
                break;
            //case 404: 
            //    break
            case 429:
                var retryAfter = res.headers["retry-after"];
                console.log("429 Rate Limit, wait",retryAfter,"seconds");
                setTimeout(function(){
                    addRanks(g,callback);
                },retryAfter*1000);
                break;
            case 403: 
                console.log("403");
                break;            
            default:
                console.log(res.statusCode);
        }

    }).on('error', function(e) {
        console.error(e);
    });
}

function formulateTeam(g){
    g.roleArranged = true;
    g.roleResult = Array(0,1,2,3,4,5,6,7,8,9);
    p = g.participants;

    for(var team=0;team<=5;team+=5){
        var roleAssigned = Array(false,false,false,false,false);
        var playerAssigned = Array(false,false,false,false,false);
        
        for(var t = 0;t<5;t++){
            var highestIndex = new Array();//array giving the best player(0-4) for the given role(0-4)

            var highestDiff=0;
            var highestDiffIndex=-1;

            //for each role, most and second most likely
            for(var role=0;role<5;role++){
                if(roleAssigned[role])
                    continue;

                var highestVal=0, nextHighestVal=0;
                for(var i=0;i<5;i++){
                    if(playerAssigned[i])
                        continue;

                    var val = roleRate[chaArr[p[i+team].championId].key]==undefined ? 0 : roleRate[chaArr[p[i+team].championId].key][role];
                    if(val>=nextHighestVal){                
                        if(val>=highestVal){
                            nextHighestVal = highestVal;
                            highestVal = val;
                            highestIndex[role] = i;
                        }
                        else
                            nextHighestVal=val;
                    }
                }
                if(highestVal - nextHighestVal >= highestDiff){
                    highestDiff = highestVal - nextHighestVal;
                    highestDiffIndex = role;
                }

            }
            //console.log(highestDiff + "\t" + roleName[highestDiffIndex] +"\t\t" +  chaArr[p[highestIndex[highestDiffIndex]+team].championId].key + " " );
            if(team==0)
                g.roleResult[highestDiffIndex] = highestIndex[highestDiffIndex];
            else
                g.roleResult[9-highestDiffIndex] = 5+highestIndex[highestDiffIndex];
            roleAssigned[highestDiffIndex] = true;
            playerAssigned[highestIndex[highestDiffIndex]] = true;
        }
        //console.log();
    }
}

var roleRate = {
  "Annie":[0,0,80,0,20],
  "Olaf":[80,20,0,0,0],
  "Galio":[0,0,100,0,0],
  "TwistedFate":[0,0,100,0,0],
  "XinZhao":[0,90,0,0,0],
  "Urgot":[20,0,50,0,30],
  "Leblanc":[0,0,90,0,0],
  "Vladimir":[50,0,50,0,0],
  "FiddleSticks":[0,90,0,0,10],
  "Kayle":[20,0,80,0,0],
  "MasterYi":[0,90,0,0,0],
  "Alistar":[20,0,0,0,80],
  "Ryze":[80,0,20,0,0],
  "Sion":[70,30,0,0,0],
  "Sivir":[0,0,0,100,0],
  "Soraka":[0,0,0,0,100],
  "Teemo":[100,0,0,0,0],
  "Tristana":[0,0,0,100,0],
  "Warwick":[0,100,0,0,0],
  "Nunu":[0,90,0,0,0],
  "MissFortune":[0,0,0,90,0],
  "Ashe":[0,0,0,90,0],
  "Tryndamere":[80,10,0,0,0],
  "Jax":[90,0,0,0,0],
  "Morgana":[0,0,30,50,0],
  "Zilean":[0,0,30,0,30],
  "Singed":[80,0,0,0,0],
  "Evelynn":[0,90,0,0,0],
  "Twitch":[0,0,0,90,0],
  "Karthus":[10,0,90,0,0],
  "Chogath":[90,0,0,0,0],
  "Amumu":[0,90,0,0,0],
  "Rammus":[0,90,0,0,0],
  "Anivia":[0,0,90,0,0],
  "Shaco":[0,90,0,0,0],
  "DrMundo":[90,10,0,0,0],
  "Sona":[0,0,0,0,90],
  "Kassadin":[30,0,80,0,0],
  "Irelia":[30,0,0,0,0],
  "Janna":[0,0,0,0,90],
  "Gangplank":[80,0,0,0,0],
  "Corki":[0,0,20,80,0],
  "Karma":[0,0,0,0,90],
  "Taric":[0,0,0,0,90],
  "Veigar":[0,0,80,0,0],
  "Trundle":[70,30,0,0,0],
  "Swain":[40,0,60,0,0],
  "Caitlyn":[0,0,0,90,0],
  "Blitzcrank":[0,0,0,0,90],
  "Malphite":[70,20,0,0,0],
  "Katarina":[0,0,90,0,0],
  "Nocturne":[0,90,0,0,0],
  "Maokai":[80,10,0,0,0],
  "Renekton":[80,0,0,0,0],
  "JarvanIV":[70,30,0,0,0],
  "Elise":[0,90,0,0,0],
  "Orianna":[0,0,90,0,0],
  "MonkeyKing":[0,90,0,0,0],
  "Brand":[0,0,90,0,0],
  "LeeSin":[0,90,0,0,0],
  "Vayne":[10,0,0,90,0],
  "Rumble":[90,0,0,0,0],
  "Cassiopeia":[30,0,70,0,0],
  "Skarner":[0,90,0,0,0],
  "Heimerdinger":[70,0,30,0,0],
  "Nasus":[80,10,0,0,0],
  "Nidalee":[20,80,0,0,0],
  "Udyr":[0,90,0,0,0],
  "Poppy":[0,80,0,0,0],
  "Gragas":[0,80,0,0,0],
  "Pantheon":[40,40,0,0,0],
  "Ezreal":[0,0,50,50,0],
  "Mordekaiser":[10,10,10,60,0],
  "Yorick":[90,0,0,0,0],
  "Akali":[50,0,50,0,0],
  "Kennen":[60,0,30,0,10],
  "Garen":[90,0,0,0,0],
  "Leona":[0,0,0,0,90],
  "Malzahar":[0,0,90,0,0],
  "Talon":[0,0,90,0,0],
  "Riven":[90,0,0,0,0],
  "KogMaw":[0,0,70,20,0],
  "Shen":[50,0,0,0,50],
  "Lux":[0,0,90,0,0],
  "Xerath":[0,0,90,0,0],
  "Shyvana":[0,90,0,0,0],
  "Ahri":[0,0,90,0,0],
  "Graves":[0,0,0,90,0],
  "Fizz":[50,20,50,0,0],
  "Volibear":[10,70,0,0,0],
  "Rengar":[10,80,0,0,0],
  "Varus":[0,0,40,40,0],
  "Nautilus":[30,30,0,0,40],
  "Viktor":[0,0,90,0,0],
  "Sejuani":[0,90,0,0,0],
  "Fiora":[90,0,0,0,0],
  "Ziggs":[0,0,90,0,0],
  "Lulu":[30,0,30,0,20],
  "Draven":[0,0,0,90,0],
  "Hecarim":[50,50,0,0,0],
  "Khazix":[0,90,0,0,0],
  "Darius":[80,10,0,0,10],
  "Jayce":[50,0,50,0,0],
  "Lissandra":[90,0,0,0,0],
  "Diana":[50,0,50,0,0],
  "Quinn":[40,0,0,40,0],
  "Syndra":[0,0,90,0,0],
  "Zyra":[0,0,40,0,40],
  "Gnar":[90,0,0,0,0],
  "Zac":[0,90,0,0,0],
  "Yasuo":[40,0,60,0,0],
  "Velkoz":[0,0,70,0,20],
  "Braum":[0,0,0,0,90],
  "Jinx":[0,0,0,90,0],
  "TahmKench":[0,0,0,0,100],
  "Lucian":[0,0,0,90,0],
  "Zed":[20,0,80,0,0],
  "Ekko":[0,50,50,0,0],
  "Vi":[0,90,0,0,0],
  "Aatrox":[20,80,0,0,0],
  "Nami":[0,0,0,0,90],
  "Azir":[5,0,90,0,5],
  "Thresh":[0,0,0,0,90],
  "RekSai":[0,90,0,0,0],
  "Kalista":[0,0,0,90,0],
  "Bard":[0,0,0,0,90]
}

var chaArr = 
{
      "35": {
         "id": 35,
         "title": "the Demon Jester",
         "name": "Shaco",
         "key": "Shaco"
      },
      "36": {
         "id": 36,
         "title": "the Madman of Zaun",
         "name": "Dr. Mundo",
         "key": "DrMundo"
      },
      "33": {
         "id": 33,
         "title": "the Armordillo",
         "name": "Rammus",
         "key": "Rammus"
      },
      "34": {
         "id": 34,
         "title": "the Cryophoenix",
         "name": "Anivia",
         "key": "Anivia"
      },
      "39": {
         "id": 39,
         "title": "the Will of the Blades",
         "name": "Irelia",
         "key": "Irelia"
      },
      "157": {
         "id": 157,
         "title": "the Unforgiven",
         "name": "Yasuo",
         "key": "Yasuo"
      },
      "37": {
         "id": 37,
         "title": "Maven of the Strings",
         "name": "Sona",
         "key": "Sona"
      },
      "38": {
         "id": 38,
         "title": "the Void Walker",
         "name": "Kassadin",
         "key": "Kassadin"
      },
      "154": {
         "id": 154,
         "title": "the Secret Weapon",
         "name": "Zac",
         "key": "Zac"
      },
      "150": {
         "id": 150,
         "title": "the Missing Link",
         "name": "Gnar",
         "key": "Gnar"
      },
      "43": {
         "id": 43,
         "title": "the Enlightened One",
         "name": "Karma",
         "key": "Karma"
      },
      "42": {
         "id": 42,
         "title": "the Daring Bombardier",
         "name": "Corki",
         "key": "Corki"
      },
      "41": {
         "id": 41,
         "title": "the Saltwater Scourge",
         "name": "Gangplank",
         "key": "Gangplank"
      },
      "40": {
         "id": 40,
         "title": "the Storm's Fury",
         "name": "Janna",
         "key": "Janna"
      },
      "201": {
         "id": 201,
         "title": "the Heart of the Freljord",
         "name": "Braum",
         "key": "Braum"
      },
      "22": {
         "id": 22,
         "title": "the Frost Archer",
         "name": "Ashe",
         "key": "Ashe"
      },
      "23": {
         "id": 23,
         "title": "the Barbarian King",
         "name": "Tryndamere",
         "key": "Tryndamere"
      },
      "24": {
         "id": 24,
         "title": "Grandmaster at Arms",
         "name": "Jax",
         "key": "Jax"
      },
      "25": {
         "id": 25,
         "title": "Fallen Angel",
         "name": "Morgana",
         "key": "Morgana"
      },
      "26": {
         "id": 26,
         "title": "the Chronokeeper",
         "name": "Zilean",
         "key": "Zilean"
      },
      "27": {
         "id": 27,
         "title": "the Mad Chemist",
         "name": "Singed",
         "key": "Singed"
      },
      "28": {
         "id": 28,
         "title": "the Widowmaker",
         "name": "Evelynn",
         "key": "Evelynn"
      },
      "29": {
         "id": 29,
         "title": "the Plague Rat",
         "name": "Twitch",
         "key": "Twitch"
      },
      "3": {
         "id": 3,
         "title": "the Sentinel's Sorrow",
         "name": "Galio",
         "key": "Galio"
      },
      "161": {
         "id": 161,
         "title": "the Eye of the Void",
         "name": "Vel'Koz",
         "key": "Velkoz"
      },
      "2": {
         "id": 2,
         "title": "the Berserker",
         "name": "Olaf",
         "key": "Olaf"
      },
      "1": {
         "id": 1,
         "title": "the Dark Child",
         "name": "Annie",
         "key": "Annie"
      },
      "7": {
         "id": 7,
         "title": "the Deceiver",
         "name": "LeBlanc",
         "key": "Leblanc"
      },
      "30": {
         "id": 30,
         "title": "the Deathsinger",
         "name": "Karthus",
         "key": "Karthus"
      },
      "6": {
         "id": 6,
         "title": "the Headsman's Pride",
         "name": "Urgot",
         "key": "Urgot"
      },
      "32": {
         "id": 32,
         "title": "the Sad Mummy",
         "name": "Amumu",
         "key": "Amumu"
      },
      "5": {
         "id": 5,
         "title": "the Seneschal of Demacia",
         "name": "Xin Zhao",
         "key": "XinZhao"
      },
      "31": {
         "id": 31,
         "title": "the Terror of the Void",
         "name": "Cho'Gath",
         "key": "Chogath"
      },
      "4": {
         "id": 4,
         "title": "the Card Master",
         "name": "Twisted Fate",
         "key": "TwistedFate"
      },
      "9": {
         "id": 9,
         "title": "the Harbinger of Doom",
         "name": "Fiddlesticks",
         "key": "FiddleSticks"
      },
      "8": {
         "id": 8,
         "title": "the Crimson Reaper",
         "name": "Vladimir",
         "key": "Vladimir"
      },
      "19": {
         "id": 19,
         "title": "the Blood Hunter",
         "name": "Warwick",
         "key": "Warwick"
      },
      "17": {
         "id": 17,
         "title": "the Swift Scout",
         "name": "Teemo",
         "key": "Teemo"
      },
      "18": {
         "id": 18,
         "title": "the Yordle Gunner",
         "name": "Tristana",
         "key": "Tristana"
      },
      "15": {
         "id": 15,
         "title": "the Battle Mistress",
         "name": "Sivir",
         "key": "Sivir"
      },
      "16": {
         "id": 16,
         "title": "the Starchild",
         "name": "Soraka",
         "key": "Soraka"
      },
      "13": {
         "id": 13,
         "title": "the Rogue Mage",
         "name": "Ryze",
         "key": "Ryze"
      },
      "14": {
         "id": 14,
         "title": "The Undead Juggernaut",
         "name": "Sion",
         "key": "Sion"
      },
      "11": {
         "id": 11,
         "title": "the Wuju Bladesman",
         "name": "Master Yi",
         "key": "MasterYi"
      },
      "12": {
         "id": 12,
         "title": "the Minotaur",
         "name": "Alistar",
         "key": "Alistar"
      },
      "21": {
         "id": 21,
         "title": "the Bounty Hunter",
         "name": "Miss Fortune",
         "key": "MissFortune"
      },
      "20": {
         "id": 20,
         "title": "the Yeti Rider",
         "name": "Nunu",
         "key": "Nunu"
      },
      "107": {
         "id": 107,
         "title": "the Pridestalker",
         "name": "Rengar",
         "key": "Rengar"
      },
      "106": {
         "id": 106,
         "title": "the Thunder's Roar",
         "name": "Volibear",
         "key": "Volibear"
      },
      "105": {
         "id": 105,
         "title": "the Tidal Trickster",
         "name": "Fizz",
         "key": "Fizz"
      },
      "104": {
         "id": 104,
         "title": "the Outlaw",
         "name": "Graves",
         "key": "Graves"
      },
      "103": {
         "id": 103,
         "title": "the Nine-Tailed Fox",
         "name": "Ahri",
         "key": "Ahri"
      },
      "99": {
         "id": 99,
         "title": "the Lady of Luminosity",
         "name": "Lux",
         "key": "Lux"
      },
      "102": {
         "id": 102,
         "title": "the Half-Dragon",
         "name": "Shyvana",
         "key": "Shyvana"
      },
      "101": {
         "id": 101,
         "title": "the Magus Ascendant",
         "name": "Xerath",
         "key": "Xerath"
      },
      "412": {
         "id": 412,
         "title": "the Chain Warden",
         "name": "Thresh",
         "key": "Thresh"
      },
      "98": {
         "id": 98,
         "title": "Eye of Twilight",
         "name": "Shen",
         "key": "Shen"
      },
      "222": {
         "id": 222,
         "title": "the Loose Cannon",
         "name": "Jinx",
         "key": "Jinx"
      },
      "96": {
         "id": 96,
         "title": "the Mouth of the Abyss",
         "name": "Kog'Maw",
         "key": "KogMaw"
      },
      "223": {
         "id": 223,
         "title": "the River King",
         "name": "Tahm Kench",
         "key": "TahmKench"
      },
      "92": {
         "id": 92,
         "title": "the Exile",
         "name": "Riven",
         "key": "Riven"
      },
      "91": {
         "id": 91,
         "title": "the Blade's Shadow",
         "name": "Talon",
         "key": "Talon"
      },
      "90": {
         "id": 90,
         "title": "the Prophet of the Void",
         "name": "Malzahar",
         "key": "Malzahar"
      },
      "429": {
         "id": 429,
         "title": "the Spear of Vengeance",
         "name": "Kalista",
         "key": "Kalista"
      },
      "10": {
         "id": 10,
         "title": "The Judicator",
         "name": "Kayle",
         "key": "Kayle"
      },
      "421": {
         "id": 421,
         "title": "the Void Burrower",
         "name": "Rek'Sai",
         "key": "RekSai"
      },
      "89": {
         "id": 89,
         "title": "the Radiant Dawn",
         "name": "Leona",
         "key": "Leona"
      },
      "79": {
         "id": 79,
         "title": "the Rabble Rouser",
         "name": "Gragas",
         "key": "Gragas"
      },
      "117": {
         "id": 117,
         "title": "the Fae Sorceress",
         "name": "Lulu",
         "key": "Lulu"
      },
      "114": {
         "id": 114,
         "title": "the Grand Duelist",
         "name": "Fiora",
         "key": "Fiora"
      },
      "78": {
         "id": 78,
         "title": "the Iron Ambassador",
         "name": "Poppy",
         "key": "Poppy"
      },
      "115": {
         "id": 115,
         "title": "the Hexplosives Expert",
         "name": "Ziggs",
         "key": "Ziggs"
      },
      "77": {
         "id": 77,
         "title": "the Spirit Walker",
         "name": "Udyr",
         "key": "Udyr"
      },
      "112": {
         "id": 112,
         "title": "the Machine Herald",
         "name": "Viktor",
         "key": "Viktor"
      },
      "113": {
         "id": 113,
         "title": "the Winter's Wrath",
         "name": "Sejuani",
         "key": "Sejuani"
      },
      "110": {
         "id": 110,
         "title": "the Arrow of Retribution",
         "name": "Varus",
         "key": "Varus"
      },
      "111": {
         "id": 111,
         "title": "the Titan of the Depths",
         "name": "Nautilus",
         "key": "Nautilus"
      },
      "119": {
         "id": 119,
         "title": "the Glorious Executioner",
         "name": "Draven",
         "key": "Draven"
      },
      "432": {
         "id": 432,
         "title": "the Wandering Caretaker",
         "name": "Bard",
         "key": "Bard"
      },
      "245": {
         "id": 245,
         "title": "the Boy Who Shattered Time",
         "name": "Ekko",
         "key": "Ekko"
      },
      "82": {
         "id": 82,
         "title": "the Master of Metal",
         "name": "Mordekaiser",
         "key": "Mordekaiser"
      },
      "83": {
         "id": 83,
         "title": "the Gravedigger",
         "name": "Yorick",
         "key": "Yorick"
      },
      "80": {
         "id": 80,
         "title": "the Artisan of War",
         "name": "Pantheon",
         "key": "Pantheon"
      },
      "81": {
         "id": 81,
         "title": "the Prodigal Explorer",
         "name": "Ezreal",
         "key": "Ezreal"
      },
      "86": {
         "id": 86,
         "title": "The Might of Demacia",
         "name": "Garen",
         "key": "Garen"
      },
      "84": {
         "id": 84,
         "title": "the Fist of Shadow",
         "name": "Akali",
         "key": "Akali"
      },
      "85": {
         "id": 85,
         "title": "the Heart of the Tempest",
         "name": "Kennen",
         "key": "Kennen"
      },
      "67": {
         "id": 67,
         "title": "the Night Hunter",
         "name": "Vayne",
         "key": "Vayne"
      },
      "126": {
         "id": 126,
         "title": "the Defender of Tomorrow",
         "name": "Jayce",
         "key": "Jayce"
      },
      "69": {
         "id": 69,
         "title": "the Serpent's Embrace",
         "name": "Cassiopeia",
         "key": "Cassiopeia"
      },
      "127": {
         "id": 127,
         "title": "the Ice Witch",
         "name": "Lissandra",
         "key": "Lissandra"
      },
      "68": {
         "id": 68,
         "title": "the Mechanized Menace",
         "name": "Rumble",
         "key": "Rumble"
      },
      "121": {
         "id": 121,
         "title": "the Voidreaver",
         "name": "Kha'Zix",
         "key": "Khazix"
      },
      "122": {
         "id": 122,
         "title": "the Hand of Noxus",
         "name": "Darius",
         "key": "Darius"
      },
      "120": {
         "id": 120,
         "title": "the Shadow of War",
         "name": "Hecarim",
         "key": "Hecarim"
      },
      "72": {
         "id": 72,
         "title": "the Crystal Vanguard",
         "name": "Skarner",
         "key": "Skarner"
      },
      "236": {
         "id": 236,
         "title": "the Purifier",
         "name": "Lucian",
         "key": "Lucian"
      },
      "74": {
         "id": 74,
         "title": "the Revered Inventor",
         "name": "Heimerdinger",
         "key": "Heimerdinger"
      },
      "75": {
         "id": 75,
         "title": "the Curator of the Sands",
         "name": "Nasus",
         "key": "Nasus"
      },
      "238": {
         "id": 238,
         "title": "the Master of Shadows",
         "name": "Zed",
         "key": "Zed"
      },
      "76": {
         "id": 76,
         "title": "the Bestial Huntress",
         "name": "Nidalee",
         "key": "Nidalee"
      },
      "134": {
         "id": 134,
         "title": "the Dark Sovereign",
         "name": "Syndra",
         "key": "Syndra"
      },
      "133": {
         "id": 133,
         "title": "Demacia's Wings",
         "name": "Quinn",
         "key": "Quinn"
      },
      "59": {
         "id": 59,
         "title": "the Exemplar of Demacia",
         "name": "Jarvan IV",
         "key": "JarvanIV"
      },
      "58": {
         "id": 58,
         "title": "the Butcher of the Sands",
         "name": "Renekton",
         "key": "Renekton"
      },
      "57": {
         "id": 57,
         "title": "the Twisted Treant",
         "name": "Maokai",
         "key": "Maokai"
      },
      "56": {
         "id": 56,
         "title": "the Eternal Nightmare",
         "name": "Nocturne",
         "key": "Nocturne"
      },
      "55": {
         "id": 55,
         "title": "the Sinister Blade",
         "name": "Katarina",
         "key": "Katarina"
      },
      "64": {
         "id": 64,
         "title": "the Blind Monk",
         "name": "Lee Sin",
         "key": "LeeSin"
      },
      "62": {
         "id": 62,
         "title": "the Monkey King",
         "name": "Wukong",
         "key": "MonkeyKing"
      },
      "63": {
         "id": 63,
         "title": "the Burning Vengeance",
         "name": "Brand",
         "key": "Brand"
      },
      "268": {
         "id": 268,
         "title": "the Emperor of the Sands",
         "name": "Azir",
         "key": "Azir"
      },
      "267": {
         "id": 267,
         "title": "the Tidecaller",
         "name": "Nami",
         "key": "Nami"
      },
      "60": {
         "id": 60,
         "title": "The Spider Queen",
         "name": "Elise",
         "key": "Elise"
      },
      "131": {
         "id": 131,
         "title": "Scorn of the Moon",
         "name": "Diana",
         "key": "Diana"
      },
      "61": {
         "id": 61,
         "title": "the Lady of Clockwork",
         "name": "Orianna",
         "key": "Orianna"
      },
      "266": {
         "id": 266,
         "title": "the Darkin Blade",
         "name": "Aatrox",
         "key": "Aatrox"
      },
      "143": {
         "id": 143,
         "title": "Rise of the Thorns",
         "name": "Zyra",
         "key": "Zyra"
      },
      "48": {
         "id": 48,
         "title": "the Troll King",
         "name": "Trundle",
         "key": "Trundle"
      },
      "45": {
         "id": 45,
         "title": "the Tiny Master of Evil",
         "name": "Veigar",
         "key": "Veigar"
      },
      "44": {
         "id": 44,
         "title": "the Gem Knight",
         "name": "Taric",
         "key": "Taric"
      },
      "51": {
         "id": 51,
         "title": "the Sheriff of Piltover",
         "name": "Caitlyn",
         "key": "Caitlyn"
      },
      "53": {
         "id": 53,
         "title": "the Great Steam Golem",
         "name": "Blitzcrank",
         "key": "Blitzcrank"
      },
      "54": {
         "id": 54,
         "title": "Shard of the Monolith",
         "name": "Malphite",
         "key": "Malphite"
      },
      "254": {
         "id": 254,
         "title": "the Piltover Enforcer",
         "name": "Vi",
         "key": "Vi"
      },
      "50": {
         "id": 50,
         "title": "the Master Tactician",
         "name": "Swain",
         "key": "Swain"
      }
};