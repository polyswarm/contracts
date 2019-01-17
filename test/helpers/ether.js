const ethers = require('ethers');

export default function ether (n) {
  const val = web3.utils.toWei(n.toString(), 'ether');
  return new web3.utils.toBN(val);
}
