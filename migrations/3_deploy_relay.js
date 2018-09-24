const NectarToken = artifacts.require('NectarToken');
const ERC20Relay = artifacts.require('ERC20Relay');

module.exports = function(deployer, network, accounts) {
  // https://etherscan.io/token/0x9e46a38f5daabe8683e10793b06749eef7d733d1#readContract totalSupply
  const TOTAL_SUPPLY = '1885913075851542181982426285';

  // https://coinmarketcap.com/currencies/polyswarm/ retrieved on 5/28/18
  const NCT_ETH_EXCHANGE_RATE = 80972;

  // See docker setup
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const FEE_WALLET = '0x0f57baedcf2c84383492d1ea700835ce2492c48a';
  const VERIFIER_ADDRESSES = [
    '0xe6cc4b147e3b1b59d2ac2f2f3784bbac1774bbf7',
    '0x28fad0751f8f406d962d27b60a2a47ccceeb8096',
    '0x87cb0b17cf9ebcb0447da7da55c703812813524b',
  ];

  if (network === 'mainnet') {
    const NECTAR_ADDRESS = '0x9e46a38f5daabe8683e10793b06749eef7d733d1';
    // XXX: Change me
    const MAINNET_FEE_WALLET = '0x0f57baedcf2c84383492d1ea700835ce2492c48a';

    return deployer.deploy(ERC20Relay, NECTAR_ADDRESS, NCT_ETH_EXCHANGE_RATE,
      FEE_WALLET, VERIFIER_ADDRESSES);
  } else {
    return deployer.deploy(NectarToken).then(() => {
      // If we're on the homechain, assign all tokens to the user, else assign
      // all tokens to the relay contract for disbursal on the sidechain
      //
      // Else for testing purposes, give both the user and the relay tokens
      if (network === 'homechain') {
        return deployer.deploy(ERC20Relay, NectarToken.address, NCT_ETH_EXCHANGE_RATE, FEE_WALLET, VERIFIER_ADDRESSES).then(() => {
          return NectarToken.deployed().then(token => {
            return token.mint(accounts[0], TOTAL_SUPPLY);
          });
        });
      } else if (network == 'sidechain') {
        return deployer.deploy(ERC20Relay, NectarToken.address, 0, ZERO_ADDRESS, VERIFIER_ADDRESSES).then(() => {
          return NectarToken.deployed().then(token => {
            return token.mint(ERC20Relay.address, TOTAL_SUPPLY);
          });
        });
      } else if (network == 'development') {
        return deployer.deploy(ERC20Relay, NectarToken.address, NCT_ETH_EXCHANGE_RATE, FEE_WALLET, VERIFIER_ADDRESSES).then(() => {
          return NectarToken.deployed().then(token => {
            return token.mint(accounts[0], TOTAL_SUPPLY).then(() => {;
              return token.mint(ERC20Relay.address, TOTAL_SUPPLY);
            });
          });
        });
      }
    });
  }
};
