var fs = require('fs');
var http = require('http');
var MongoClient = require('mongodb').MongoClient;

http.createServer(function (req, res) {
	console.log("Received http request to",req.url);
  if(req.url=='/query')
    query(req,res);  
  else{
    standardHTTP(req,res); 
  }
}).listen(80);
console.log('Webserver running at http://127.0.0.1:80/');

function query(req,res){
  MongoClient.connect('mongodb://localhost:27017/ss', function(err, db) {
      //console.log("Connected correctly to db");

      findDocuments(db,function(docs){
        res.writeHead(200);
        res.write(JSON.stringify(docs));
        res.end();
        db.close();
      });
  });
}

var whitelist = ["/index.html","/icon.css"];
function standardHTTP(req,res){
  if(whitelist.indexOf(req.url)==-1)
    req.url="/index.html";

  fs.readFile(req.url.substring(1), function (err,data) {
    if (err) {
      //console.log(req);
      res.writeHead(404);
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.write(data);
    res.end();
  });  
}

function findDocuments(db, callback) {
  // Get the documents collection
  var collection = db.collection('games');
  // Find some documents
  //collection.find({gameMode:'CLASSIC',gameType:'MATCHED_GAME'}).toArray(function(err, docs) {
  collection.find({}).toArray(function(err, docs) {
      callback(docs);
  });
}

/*SERVER FLOWCHART 1.3
1. receive html request to localhost:1337
1.5 send html reponse immediately

2.client onload requests all games as ajax
2.1 retrieve db info (as json) via request to mongod
2.2 send obj immediately to client to be processed by client js?

3.user selects custom querys which are sent as ajax
*/