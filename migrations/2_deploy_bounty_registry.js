const NectarToken = artifacts.require('NectarToken');
const BountyRegistry = artifacts.require('BountyRegistry');

module.exports = function(deployer, network, accounts) {
  const NECTAR_ADDRESS = "0x0000000000000000000000000000000000000000";
  deployer.deploy(BountyRegistry, NECTAR_ADDRESS);
};
