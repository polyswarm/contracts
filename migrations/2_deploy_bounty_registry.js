const NectarToken = artifacts.require('NectarToken');
const BountyRegistry = artifacts.require('BountyRegistry');

module.exports = function(deployer, network, accounts) {
  const NECTAR_ADDRESS = '0x9e46a38f5daabe8683e10793b06749eef7d733d1';
  deployer.deploy(BountyRegistry, NECTAR_ADDRESS);
};
