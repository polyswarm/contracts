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
    '0x8ba785d521735b04d9da615e7acd469da578356d',
    '0x3f5d0751736d89fb519c88a153413fbbf4456f49',
    '0xb15fb44788e5eda896247ef4e3d552ccc05f5d6b',
    '0x315bf9dfc4f27b02c8e2df0b541ac601c352613d',
    '0xa6fe9a9ecd482934779aa896db8dd1488bdde3d2',
  ];

  if (network === 'mainnet') {
    const NECTAR_ADDRESS = '0x9e46a38f5daabe8683e10793b06749eef7d733d1';
    const MAINNET_FEE_WALLET = '0x19754e8138E4318653E14deA03d2Dd4AA945E19c';

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
