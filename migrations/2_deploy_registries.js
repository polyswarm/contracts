const NectarToken = artifacts.require('NectarToken');
const BountyRegistry = artifacts.require('BountyRegistry');
const OfferRegistry = artifacts.require('OfferRegistry');

module.exports = function(deployer, network, accounts) {
  if (network === 'mainnet') {
    // Deployed NCT contract
    const NECTAR_ADDRESS = '0x9e46a38f5daabe8683e10793b06749eef7d733d1';
    // ~7 days in blocks
    const ARBITER_VOTE_WINDOW = 40320
    // ~4 months in blocks
    const STAKE_DURATION = 701333;

    return deployer.deploy(BountyRegistry, NECTAR_ADDRESS, ARBITER_VOTE_WINDOW, STAKE_DURATION).then(() => {
      return deployer.deploy(OfferRegistry, NectarToken.address);
    });
  } else {
    return deployer.deploy(NectarToken).then(() => {
      const ARBITER_VOTE_WINDOW = 100;
      const STAKE_DURATION = 100;

      return deployer.deploy(BountyRegistry, NectarToken.address, ARBITER_VOTE_WINDOW, STAKE_DURATION);
    }).then(() => {
      return deployer.deploy(OfferRegistry, NectarToken.address);
    });
  }
};
