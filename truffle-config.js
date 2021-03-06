const fs = require('fs');
const yaml = require('js-yaml');
require('babel-register');
require('babel-polyfill');

let options = null
if (process.env.OPTIONS && fs.existsSync(process.env.OPTIONS)) {
  try {
    options = yaml.safeLoad(fs.readFileSync(process.env.OPTIONS, 'utf-8'));
  } catch (e) {
    console.error('Failied reading options');
    console.error(e);
    process.exit(1);
  }
}

module.exports = {
  networks: {
    development: {
      host: process.env.geth || '0.0.0.0',
      port: process.env.port || 8545,
      network_id: '*',
      // Need to lower this until contracts#74 is resolved
      gasPrice: 100000000000,
    },
    rinkeby: {
      host: 'localhost',
      port: 8545,
      network_id: '4',
      gas: 7000000,
    },
    mainnet: {
      host: 'localhost',
      port: 8545,
      network_id: '1',
      gas: 9400000,
    },
  },
  solc: {
    optimizer: {
      enabled: true,
      runs: 200
    }
  }
};
