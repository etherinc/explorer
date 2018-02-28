require( '../db.js' );
var etherUnits = require("../lib/etherUnits.js");
var BigNumber = require('bignumber.js');

var fs = require('fs');

var Web3 = require('web3');

var mongoose = require( 'mongoose' );
var Block     = mongoose.model( 'Block' );
var Transaction     = mongoose.model( 'Transaction' );

var RPC_HOST = process.env.RPC_HOST || "localhost";
var gethPort = process.env.gethPort || 8545;
var listenOnly = process.env.listenOnly || false;
var startBlock = process.env.startBlockno || 0;
var quiet = process.env.quiet || true;
var terminateAtExistingDB = process.env.terminateAtExistingDB || false;
var skipTransactions = process.env.skipTransactions || false;

var grabBlocks = function(startBlockno) {
    var web3 = new Web3(new Web3.providers.HttpProvider('http://'+RPC_HOST+':' + gethPort.toString()));
    
    if(listenOnly === true) 
        listenBlocks(web3);
    else
        setTimeout(function() {
            grabBlock(web3, startBlockno);
        }, 2000);
}

var listenBlocks = function(web3) {
    var newBlocks = web3.eth.filter("latest");
    newBlocks.watch(function (error, log) {

        if(error) {
            console.log('Error: ' + error);
        } else if (log == null) {
            console.log('Warning: null block hash');
        } else {
            grabBlock(web3, log);
        }

    });
}

var grabBlock = function(web3, blockNumber) {
    var desiredBlockNumber = blockNumber;

    // check if done
    if(blockNumber == undefined) {
        return; 
    }

    if(web3.isConnected()) {

        web3.eth.getBlock(desiredBlockNumber, true, function(error, blockData) {
            if(error) {
                console.log('Warning: error on getting block with hash/number: ' +
                    desiredBlockNumber + ': ' + error);
            }
            else if(blockData == null) {
                console.log('Warning: null block data received from the block with hash/number: ' +
                    desiredBlockNumber);
            }
            else {
                if(terminateAtExistingDB === true) {
                    checkBlockDBExistsThenWrite(blockData);
                }
                else {
                    writeBlockToDB(blockData);
                }
                if (skipTransactions === false)
                    writeTransactionsToDB(blockData);
                if(listenOnly === true) 
                    return;

                if('hash' in blockData && 'number' in blockData) {
                    // If currently working on an interval (typeof blockHashOrNumber === 'object') and 
                    // the block number or block hash just grabbed isn't equal to the start yet: 
                    // then grab the parent block number (<this block's number> - 1). Otherwise done 
                    // with this interval object (or not currently working on an interval) 
                    // -> so move onto the next thing in the blocks array.
//                     if(blockData['number'] > blockNumber) {
//                         blockNumber = blockData['number'] + 1;
//                         grabBlock(web3, blockNumber);
//                     }
//                     else {
//                         grabBlock(web3, blockNumber);
//                     }
                    grabBlock(web3, blockData['number'] + 1);
                }
                else {
                    console.log('Error: No hash or number was found for block: ' + blockHashOrNumber);
                    process.exit(9);
                }
            }
        });
    }
    else {
        console.log('Error: Aborted due to web3 is not connected when trying to ' +
            'get block ' + desiredBlockHashOrNumber);
        process.exit(9);
    }
}


var writeBlockToDB = function(blockData) {
    return new Block(blockData).save( function( err, block, count ){
        if ( typeof err !== 'undefined' && err ) {
            if (err.code == 11000) {
                console.log('Skip: Duplicate key ' + 
                blockData.number.toString() + ': ' + 
                err);
            } else {
               console.log('Error: Aborted due to error on ' + 
                    'block number ' + blockData.number.toString() + ': ' + 
                    err);
               process.exit(9);
           }
        } else {
            if(quiet === false) {
                console.log('DB successfully written for block number ' +
                    blockData.number.toString() );
            }            
        }
      });
}

/**
  * Checks if the a record exists for the block number then ->
  *     if record exists: abort
  *     if record DNE: write a file for the block
  */
var checkBlockDBExistsThenWrite = function(blockData) {
    Block.find({number: blockData.number}, function (err, b) {
        if (!b.length)
            writeBlockToDB(blockData);
        else {
            console.log('Aborting because block number: ' + blockData.number.toString() + 
                ' already exists in DB.');
            process.exit(9);
        }

    })
}

/**
    Break transactions out of blocks and write to DB
**/

var writeTransactionsToDB = function(blockData) {
    var bulkOps = [];
    if (blockData.transactions.length > 0) {
        for (d in blockData.transactions) {
            var txData = blockData.transactions[d];
            txData.timestamp = blockData.timestamp;
            txData.value = etherUnits.toEther(new BigNumber(txData.value), 'wei');
            bulkOps.push(txData);
        }
        Transaction.collection.insert(bulkOps, function( err, tx ){
            if ( typeof err !== 'undefined' && err ) {
                if (err.code == 11000) {
                    console.log('Skip: Duplicate key ' + 
                    err);
                } else {
                   console.log('Error: Aborted due to error: ' + 
                        err);
                   process.exit(9);
               }
            } else if(quiet === false) {
                console.log('DB successfully written for block ' +
                    blockData.transactions.length.toString() );
                
            }
        });
    }
}

/*
  Patch Missing Blocks
*/
var patchBlocks = function() {
    var web3 = new Web3(new Web3.providers.HttpProvider('http://'+RPC_HOST+':' + gethPort.toString()));

    // number of blocks should equal difference in block numbers
    var firstBlock = 0;
    var lastBlock = web3.eth.blockNumber;
    blockIter(web3, firstBlock, lastBlock);
}

var blockIter = function(web3, firstBlock, lastBlock) {
    // if consecutive, deal with it
    if (lastBlock < firstBlock)
        return;
    if (lastBlock - firstBlock === 1) {
        [lastBlock, firstBlock].forEach(function(blockNumber) {
            Block.find({number: blockNumber}, function (err, b) {
                if (!b.length)
                    grabBlock(web3, firstBlock);
            });
        });
    } else if (lastBlock === firstBlock) {
        Block.find({number: firstBlock}, function (err, b) {
            if (!b.length)
                grabBlock(web3, firstBlock);
        });
    } else {

        Block.count({number: {$gte: firstBlock, $lte: lastBlock}}, function(err, c) {
          var expectedBlocks = lastBlock - firstBlock + 1;
          if (c === 0) {
            grabBlock(web3, firstBlock);
          } else if (expectedBlocks > c) {
            console.log("Missing: " + JSON.stringify(expectedBlocks - c));  
            var midBlock = firstBlock + parseInt((lastBlock - firstBlock)/2); 
            blockIter(web3, firstBlock, midBlock);
            blockIter(web3, midBlock + 1, lastBlock);
          } else 
            return;
        })
    }
}


/** On Startup **/
// geth --rpc --rpcaddr "localhost" --rpcport "8545"  --rpcapi "eth,net,web3"
// set the default geth port if it's not provided
if ((typeof gethPort) !== 'number') {
    gethPort = 8545; // default
}

var query = Block.find().sort({number:1}).limit(1);
query.exec(function (err, lastblock) { 
    if(err) {
        console.log('Error: ' + err);
    } else {
        if(lastblock[0].number){ 
            grabBlocks(lastblock[0].number + 1);
        } else {
            grabBlocks(startBlock);
        }
    }
});

// patchBlocks();
