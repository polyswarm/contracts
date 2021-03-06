const NectarToken = artifacts.require('NectarToken');
const ArbiterStaking = artifacts.require('ArbiterStaking');
const BountyRegistry = artifacts.require('BountyRegistry');
const OfferRegistry = artifacts.require('OfferRegistry');

module.exports = function(deployer, network, accounts) {
  if (network === 'mainnet') {
    // Deployed NCT contract
    const NECTAR_ADDRESS = '0x9e46a38f5daabe8683e10793b06749eef7d733d1';
    // ~7 days in blocks
    const ARBITER_VOTE_WINDOW = 40320;
    // ~4 months in blocks
    const STAKE_DURATION = 701333;

    return deployer.deploy(ArbiterStaking, NectarToken.address, STAKE_DURATION).then(() => {
      return deployer.deploy(BountyRegistry, NECTAR_ADDRESS, ArbiterStaking.address, ARBITER_VOTE_WINDOW);
    }).then(async () => {
      const contractInstance = new web3.eth.Contract(ArbiterStaking.abi, ArbiterStaking.address);
      await contractInstance.methods.setBountyRegistry(BountyRegistry.address);
    })
    .then(() => {
      return deployer.deploy(OfferRegistry, NectarToken.address);
    });
  } else {
    return deployer.deploy(NectarToken).then(() => {
      const STAKE_DURATION = 100;
      return deployer.deploy(ArbiterStaking, NectarToken.address, STAKE_DURATION);
    }).then(() => {
      const ARBITER_VOTE_WINDOW = 100;
      return deployer.deploy(BountyRegistry, NectarToken.address, ArbiterStaking.address, ARBITER_VOTE_WINDOW);
    }).then(async () => {
      const contractInstance = new web3.eth.Contract(ArbiterStaking.abi, ArbiterStaking.address);
      await contractInstance.methods.setBountyRegistry(BountyRegistry.address);
    }).then(() => {
      return deployer.deploy(OfferRegistry, NectarToken.address);
    });
  }
};
