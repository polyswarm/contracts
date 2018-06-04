const NectarToken = artifacts.require('NectarToken');
const BountyRegistry = artifacts.require('BountyRegistry');
const OfferRegistry = artifacts.require('OfferRegistry');

module.exports = function(deployer, network, accounts) {
  if (network === 'mainnet') {
    const NECTAR_ADDRESS = '0x9e46a38f5daabe8683e10793b06749eef7d733d1';
    return deployer.deploy(BountyRegistry, NECTAR_ADDRESS);
  } else {
    return deployer.deploy(NectarToken).then(() => {
      return deployer.deploy(BountyRegistry, NectarToken.address);
    }).then(() => {
      return deployer.deploy(OfferRegistry, NectarToken.address);
    });
  }
};
