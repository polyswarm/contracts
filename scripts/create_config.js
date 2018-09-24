const Net = require('web3-net');
const yaml = require('js-yaml')
const args = require('args-parser')(process.argv);
const NectarToken = artifacts.require('NectarToken');
const OfferRegistry = artifacts.require('OfferRegistry');
const BountyRegistry = artifacts.require('BountyRegistry');
const ArbiterStaking = artifacts.require('ArbiterStaking');
const ERC20Relay = artifacts.require('ERC20Relay');
const OfferLib = artifacts.require('OfferLib');
const OfferMultiSig = artifacts.require('OfferMultiSig');

const ARBITER_VOTE_WINDOW = 100;
const STAKE_DURATION = 100;
const fs = require('fs');
const request = require('request-promise');
const headers = process.env.CONSUL_TOKEN ? { 'X-Consul-Token': process.env.CONSUL_TOKEN } : {};

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

module.exports = async callback => {
  const config = {};

  if (!args.home || !args.side) {
    console.log('Usage: truffle exec create_config.js --home=<homechain_url> --side=<sidechain_url> --poly-sidechain-name=<name> --ipfs=<ipfs_url> --consul=<consul_url> --options=<options_path>');
    process.exit(1);
  }

  if (args.ipfs) {
    config['ipfs_uri'] = args.ipfs
  }

  if (args.db) {
    config['db_uri'] = args.db
    config['require_api_key'] = 'true'
  } else {
    config['require_api_key'] = 'false'
  }

  let options = null
  if (args.options && fs.existsSync(args.options)) {
    options = yaml.safeLoad(fs.readFileSync(args.options, 'utf-8'));
  }

  if (args.home) {
    console.log('running for homechain')
    try {
      await deployTo(args.home, 'homechain', options);
    } catch (e) {
      console.error('Failied on homechain');
      console.error(e);
      process.exit(1);
    }
  }

  if (args.side) {
    console.log('running for sidechain')
    // Extra user accounts on the sidechain shouldn't be pre-funded. All funding should happen through a relay.
    try {
      await deployTo(args.side, 'sidechain', options);
    } catch (e) {
      console.error('Failied on sidechain');
      console.error(e);
      process.exit(1);
    }
  }

  console.log('New config created!');

  try {
    await putABI(NectarToken);
    await putABI(OfferRegistry);
    await putABI(BountyRegistry);
    await putABI(ArbiterStaking);
    await putABI(OfferLib);
    await putABI(OfferMultiSig);
    await putABI(ERC20Relay);

    await request({
      headers,
      method: 'PUT',
      url: `${args.consul}/v1/kv/${args['poly-sidechain-name']}/config`,
      json: config
    });

  } catch (e) {
    console.error('Failed to PUT contract configs');
    console.error(e);
    process.exit(1);
  }

  callback();

  async function putABI(artifact) {
    const { contractName, abi } = artifact._json;
    return await request({
      headers,
      method: 'PUT',
      url: `${args.consul}/v1/kv/${args['poly-sidechain-name']}/${contractName}`,
      json: { abi }
    });
  }

  async function putChainConfig(name, config) {
    await request({
      headers,
      method: 'PUT',
      url: `${args.consul}/v1/kv/${args['poly-sidechain-name']}/${name}`,
      json: config
    });
  }

  async function deployTo(uri, name, options) {    
    NectarToken.setProvider(new web3.providers.HttpProvider(uri));
    OfferRegistry.setProvider(new web3.providers.HttpProvider(uri));
    BountyRegistry.setProvider(new web3.providers.HttpProvider(uri));
    ERC20Relay.setProvider(new web3.providers.HttpProvider(uri));

    const nectarToken = await NectarToken.new();
    const offerRegistry = await OfferRegistry.new(nectarToken.address);
    const bountyRegistry = await BountyRegistry.new(nectarToken.address, ARBITER_VOTE_WINDOW, STAKE_DURATION);
    
    const net = new Net(new web3.providers.HttpProvider(uri));
    const chainId = await net.getId();    
    const chainConfig = {};
    let erc20Relay;

    if (name == 'homechain') {
      erc20Relay = await ERC20Relay.new(nectarToken.address, NCT_ETH_EXCHANGE_RATE, FEE_WALLET, VERIFIER_ADDRESSES);
      await nectarToken.mint(web3.eth.accounts[0], TOTAL_SUPPLY);
    } else if (name == 'sidechain') {
      erc20Relay = await ERC20Relay.new(nectarToken.address, 0, ZERO_ADDRESS, VERIFIER_ADDRESSES);
      await nectarToken.mint(erc20Relay.address, TOTAL_SUPPLY);
    }

    chainConfig.chain_id = chainId;
    chainConfig.eth_uri = uri;    
    chainConfig.nectar_token_address = nectarToken.address;
    chainConfig.bounty_registry_address = bountyRegistry.address;    
    chainConfig.offer_registry_address = offerRegistry.address;
    chainConfig.erc20_relay_address = erc20Relay.address;
    
    if (options && options.free) {
      console.log("Setting gasPrice to 0 (Free to use.)");
      chainConfig.free = 'true';
    } else {
      chainConfig.free = 'false';
    }

    await web3.eth.accounts.forEach(async account => {
      console.log('Minting tokens for ', account);
      await nectarToken.mint(account, web3.toWei(1000000000, 'ether'));
    });

    await nectarToken.enableTransfers();

    if (options && options.arbiters) {
      await Promise.all(options.arbiters
      .filter(arbiter => web3.isAddress(arbiter))
      .map(async arbiter => {
        console.log('Funding arbiter: '+ arbiter);
          await nectarToken.mint(arbiter, web3.toWei(1000000000, 'ether'));
          console.log('Adding arbiter: ' + arbiter);
          console.log(await web3.eth.blockNumber);
          await bountyRegistry.addArbiter(arbiter, await web3.eth.blockNumber);
      }));
    }

    if (options && options.accounts) {
      await Promise.all(options.accounts
      .filter(account => web3.isAddress(account))
      .map(async account => {
        console.log('Minting tokens for ', account);
        await nectarToken.mint(account, web3.toWei(1000000000, 'ether'));
      }));
    }

    await putChainConfig(name, chainConfig);
  }
};
