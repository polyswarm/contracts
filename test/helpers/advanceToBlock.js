export function advanceBlock () {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send({
      jsonrpc: '2.0',
        method: 'evm_mine',
        id: Date.now(),
      }, (err) => {
        if (err) {
          return reject(err);
        }
      resolve();
    });


  });
}

// Advances the block number by `number` blocks.
export async function advanceBlocks (number) {
  for (var i = 0; i < number; i++) {
    await advanceBlock();
  }
}

// Advances the block number so that the last mined block is `number`.
export default async function advanceToBlock (number) {
  if (await web3.eth.getBlockNumber() > number) {
    throw Error(`block number ${number} is in the past (current is ${await web3.eth.getBlockNumber()})`);
  }

  while (await web3.eth.getBlockNumber() < number) {
    await advanceBlock();
  }
}
