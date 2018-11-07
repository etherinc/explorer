var mongoose = require( 'mongoose' );

var Block     = mongoose.model( 'Block' );
var Transaction = mongoose.model( 'Transaction' );
var Balance = mongoose.model( 'Balance' );
var filters = require('./filters')


var async = require('async');

module.exports = function(app){
  var web3relay = require('./web3relay');

  var DAO = require('./dao');
  var Token = require('./token');

  var compile = require('./compiler');
  var fiat = require('./fiat');
  var stats = require('./stats');

  /* 
    Local DB: data request format
    { "address": "0x1234blah", "txin": true } 
    { "tx": "0x1234blah" }
    { "block": "1234" }
  */
  app.post('/addr', getAddr);
  app.post('/tx', getTx);
  app.post('/block', getBlock);
  app.post('/data', getData);

  app.post('/daorelay', DAO);
  app.post('/tokenrelay', Token);  
  app.post('/web3relay', web3relay.data);
  app.post('/compile', compile);

  app.post('/fiat', fiat);
  app.post('/stats', stats);
  
  app.post('/listtxn', listtxns);
  app.post('/lastblock', lastblock);
  
  
  app.post('/richlist', richlist);
}

var richlist = function(req, res){
    var fromLimit = parseInt(req.body.count);
    
    Block.find({}).sort({number:-1}).limit(1).exec("find", function (err2, total_blocks) {
        if (total_blocks){
            var all_blocks = total_blocks[0].number;
            var block_reward = 3;
            var circulating_supply = 0;
            
            circulating_supply = all_blocks * block_reward;
            circulating_supply = circulating_supply + 205131818; //   coinsale
            circulating_supply = circulating_supply + 97528142; //   ethereum fork reward
    
            Balance.find({}).exec("count", function (err1, total_record) {
                if (total_record){
                    var listaddress = Balance.find({})
                    var data = {};
                    listaddress.sort({amount:-1}).skip(fromLimit).limit(10).exec("find", function (err, docs) {
                        if (docs)
                            data.result = docs;
                        data.total_supply = circulating_supply;
                        data.total = total_record * 50;
                        res.write(JSON.stringify(data));
                        res.end();
                    });
                }
            });
        }
    });
    
    
//   var listaddress = Balance.find({})
//   var data = {};
//   listaddress.sort({amount:-1}).limit(10).exec("find", function (err, docs) {
//     if (docs)
//       docs.supply = 10;
//       data.result = docs;
//     res.write(JSON.stringify(data));
//     res.end();
//   });
};

var listtxns = function(req, res){
  var addr = req.body.addr.toLowerCase();
  var blockNumber = parseInt(req.body.blockNumber);
  var txnlistFind = Transaction.find({ $and : [ {"to": addr}, {"blockNumber": { $gt: blockNumber }} ] })  
  var data = {};
  txnlistFind.exec("find", function (err, docs) {
    if (docs)
      data.result = docs;
    res.write(JSON.stringify(data));
    res.end();
  });
};

var lastblock = function(req, res){
  var addr = req.body.addr.toLowerCase();
  var lastblockFind = Transaction.find({"to": addr})  
  var data = {};
  lastblockFind.sort({blockNumber:-1}).limit(1).exec("find", function (err, docs) {
    if (docs)
      data.result = docs;
    res.write(JSON.stringify(data));
    res.end();
  });
};

var getAddr = function(req, res){
  // TODO: validate addr and tx
  var addr = req.body.addr.toLowerCase();
  var count = parseInt(req.body.count);

  var limit = parseInt(req.body.length);
  var start = parseInt(req.body.start);

  var data = { draw: parseInt(req.body.draw), recordsFiltered: count, recordsTotal: count };

  var addrFind = Transaction.find( { $or: [{"to": addr}, {"from": addr}] })  

  addrFind.lean(true).sort('-blockNumber').skip(start).limit(limit)
          .exec("find", function (err, docs) {
            if (docs)
              data.data = filters.filterTX(docs, addr);      
            else 
              data.data = [];
            res.write(JSON.stringify(data));
            res.end();
    });

};
 


var getBlock = function(req, res) {

  // TODO: support queries for block hash
  var txQuery = "number";
  var number = parseInt(req.body.block);

  var blockFind = Block.findOne( { number : number }).lean(true);
  blockFind.exec(function (err, doc) {
    if (err || !doc) {
      console.error("BlockFind error: " + err)
      console.error(req.body);
      res.write(JSON.stringify({"error": true}));
    } else {
      var block = filters.filterBlocks([doc]);
      res.write(JSON.stringify(block[0]));
    }
    res.end();
  });

};

var getTx = function(req, res){

  var tx = req.body.tx.toLowerCase();

  var txFind = Block.findOne( { "transactions.hash" : tx }, "transactions timestamp")
                  .lean(true);
  txFind.exec(function (err, doc) {
    if (!doc){
      console.log("missing: " +tx)
      res.write(JSON.stringify({}));
      res.end();
    } else {
      // filter transactions
      var txDocs = filters.filterBlock(doc, "hash", tx)
      res.write(JSON.stringify(txDocs));
      res.end();
    }
  });

};


/*
  Fetch data from DB
*/
var getData = function(req, res){

  // TODO: error handling for invalid calls
  var action = req.body.action.toLowerCase();
  var limit = req.body.limit

  if (action in DATA_ACTIONS) {
    if (isNaN(limit))
      var lim = MAX_ENTRIES;
    else
      var lim = parseInt(limit);
    
    DATA_ACTIONS[action](lim, res);

  } else {
  
    console.error("Invalid Request: " + action)
    res.status(400).send();
  }

};

/* 
  temporary blockstats here
*/
var latestBlock = function(req, res) {
  var block = Block.findOne({}, "totalDifficulty")
                      .lean(true).sort('-number');
  block.exec(function (err, doc) {
    res.write(JSON.stringify(doc));
    res.end();
  });
} 


var getLatest = function(lim, res, callback) {
  var blockFind = Block.find({}, "number transactions timestamp miner extraData")
                      .lean(true).sort('-number').limit(lim);
  blockFind.exec(function (err, docs) {
    callback(docs, res);
  });
}

/* get blocks from db */
var sendBlocks = function(lim, res) {
  var blockFind = Block.find({}, "number transactions timestamp miner extraData")
                      .lean(true).sort('-number').limit(lim);
  blockFind.exec(function (err, docs) {
    res.write(JSON.stringify({"blocks": filters.filterBlocks(docs)}));
    res.end();
  });
}

var sendTxs = function(lim, res) {
  Transaction.find({}).lean(true).sort('-blockNumber').limit(lim)
        .exec(function (err, txs) {
          res.write(JSON.stringify({"txs": txs}));
          res.end();
        });
}

const MAX_ENTRIES = 10;

const DATA_ACTIONS = {
  "latest_blocks": sendBlocks,
  "latest_txs": sendTxs
}


