const NectarToken = artifacts.require('NectarToken');
const BountyRegistry = artifacts.require('BountyRegistry');
const OfferRegistry = artifacts.require('OfferRegistry');
let NECTAR_TOKEN_ADDRESS;
let BOUNTY_REGISTRY_ADDRESS;
let OFFER_REGISTRY_ADDRESS;
var writeFile = require('write');

module.exports = function(deployer, network, accounts) {
    if (network === 'mainnet') {
      NECTAR_TOKEN_ADDRESS = '0x9e46a38f5daabe8683e10793b06749eef7d733d1';

      return deployer.deploy(BountyRegistry, NECTAR_ADDRESS);
    } else {
      return deployer.deploy(NectarToken).then(() => {
        return deployer.deploy(BountyRegistry, NectarToken.address);
      })

      .then(() => {
        return deployer.deploy(OfferRegistry, NectarToken.address);
      }).then(() => {

        // set values
        NECTAR_TOKEN_ADDRESS = NectarToken.address;
        BOUNTY_REGISTRY_ADDRESS = BountyRegistry.address;
        OFFER_REGISTRY_ADDRESS = OfferRegistry.address;

        const config = [];

        config.push(`NECTAR_TOKEN_ADDRESS="${NECTAR_TOKEN_ADDRESS}"`);
        config.push(`BOUNTY_REGISTRY_ADDRESS="${BOUNTY_REGISTRY_ADDRESS}"`);
        config.push(`OFFER_REGISTRY_ADDRESS="${OFFER_REGISTRY_ADDRESS}"`);

        writeFile(`${__dirname}/../build/polyswarm.contracts.cfg`, config.join('\n'), function(err) {
          if (err) console.log(err);
          console.log('new config created!')
        });

        return;
      });
    }
};


