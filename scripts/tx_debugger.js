/**
*  Gets the related event history for a bounty using it's transaction hash
*  usage:
*  txDebugger.js --tx_hash 0x26282b1432fe1ec81cd45a3d92d160511592e3983ab99761fd635bcbab34ba1b --gethUri http://localhost:8545
*  example result:
*  >>>>
    From Address: 0x3750266F07E0590aA16e55c32e08e48878010f8f
    To Address: 0x93C869190BF7731f3C6a12A8e14c3C4FBEE0F019
    TX Block:263259
    Transaction Input
    { name: 'postAssertion',
      params:
       [ { name: 'bountyGuid',
           value: '3.08265225199979733416649474483244773379e+38',
           type: 'uint128' },
         { name: 'bid', value: '62500000000000000', type: 'uint256' },
         { name: 'mask', value: '1', type: 'uint256' },
         { name: 'commitment',
           value:
            '5.7922590919982520840869556983163082015889478094586539980347643400105546566976e+76',
           type: 'uint256' } ] }
    RELATED EVENT FOUND!
    NewBounty
    Result {
      '0': '308265225199979733416649474483244773379',
      '1': '0x32F68CCec57739C88c1Fb032AF640d525Dd2bF35',
      '2': '625000000000000000',
      '3': 'QmXaTdtTcuLjPeogNYWNdYQB879ZvRL8R3WwGRZZHgywcc',
      '4': '263254',
      guid: '308265225199979733416649474483244773379',
      author: '0x32F68CCec57739C88c1Fb032AF640d525Dd2bF35',
      amount: '625000000000000000',
      artifactURI: 'QmXaTdtTcuLjPeogNYWNdYQB879ZvRL8R3WwGRZZHgywcc',
      expirationBlock: '263254' }
*
**/

const args = require('args');

args
  .option('txHash', 'the bounty transaction hash you\'re investigating')
  .option('gethUri', 'blockchain uri you\'re investigating', 'http://homechain:8545')
const abiDecoder = require('abi-decoder');
const Web3 = require('web3');
const abi = require('../build/contracts/BountyRegistry.json').abi;
const { gethUri } = args.parse(process.argv);
const txHash = process.argv[3]; // still need to get manually because `args` convert it to a Number

web3 = new Web3(new Web3.providers.HttpProvider(gethUri));
abiDecoder.addABI(abi);

web3.eth.getTransaction(txHash, function(err, result) {
    if (!err) {
        console.log('From Address: ' + result.from);
        console.log('To Address: ' + result.to);
        console.log('TX Block:' + result.blockNumber);

        const decodedInput = abiDecoder.decodeMethod(result.input);
        console.log('Transaction Input');
        console.log(decodedInput);

        const myContract = new web3.eth.Contract(abi, result.to);
        let guidBeginning = '';

        for (let param of decodedInput.params) {
            if (param.name == 'bountyGuid') {
                guidBeginning = param.value.replace('.', '').substring(0, 20)
            }
        }

        if (!guidBeginning) {
            console.error('Need a bounty guid');
            process.exit(1);
        }

        myContract.getPastEvents('allEvents', {
            fromBlock: result.blockNumber - Math.min(result.blockNumber, 300),
            toBlock: result.blockNumber
        })
        .then(function(events){
            for (let event of events) {
                const guid = event.returnValues.guid || event.returnValues.bountyGuid

                if (guid && guid.substring(0,20) == guidBeginning) {
                    console.log('RELATED EVENT FOUND!');
                    console.log('Block:' + event.blockNumber);
                    console.log(event.event);
                    console.log(event.returnValues);
                }
            }
        });

    }
    else {
        console.log('Error!', err);
    }
});
