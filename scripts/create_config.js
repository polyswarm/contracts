const Net = require('web3-net');
const yaml = require('js-yaml')
const args = require('args-parser')(process.argv);
const NectarToken = artifacts.require('NectarToken');
const OfferRegistry = artifacts.require('OfferRegistry');
const BountyRegistry = artifacts.require('BountyRegistry');
const ArbiterStaking = artifacts.require('ArbiterStaking');
const OfferLib = artifacts.require('OfferLib');
const OfferMultiSig = artifacts.require('OfferMultiSig');

const ARBITER_VOTE_WINDOW = 100;
const STAKE_DURATION = 100;
const fs = require('fs');
const request = require('request-promise');

module.exports = async callback => {
  const config = {};

  if (!args.home && !args.side) {
    console.log('Usage: truffle exec create_config.js --home=<homechain_url> --side=<sidechain_url> --ipfs=<ipfs_url> --consul=<consul_url> --options=<options_path>');
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
    await deployTo(args.home, 'homechain', options);
  }

  if (args.side) {
    console.log('running on sidechain')
    // Extra user accounts on the sidechain shouldn't be pre-funded. All funding should happen through a relay.
    await deployTo(args.side, 'sidechain', options);
  }

  console.log('New config created!');

  try {
    await putABI(NectarToken);
    await putABI(OfferRegistry);
    await putABI(BountyRegistry);
    await putABI(ArbiterStaking);
    await putABI(OfferLib);
    await putABI(OfferMultiSig);

    // config paramaters
    await request({
      method: 'PUT',
      url: `${args.consul}/v1/kv/config`,
      json: config
    });
  } catch (e) {
    console.error('Failed to PUT contract configs');
    process.exit(1);
  }

  callback();

  async function putABI(artifact) {
    const { contractName, abi } = artifact._json;
    return await request({
      method: 'PUT',
      url: `${args.consul}/v1/kv/${contractName}`,
      json: { abi }
    });
  }

  async function deployTo(uri, name, options) {    
    NectarToken.setProvider(new web3.providers.HttpProvider(uri));
    OfferRegistry.setProvider(new web3.providers.HttpProvider(uri));
    BountyRegistry.setProvider(new web3.providers.HttpProvider(uri));

    const nectarToken = await NectarToken.new();
    const offerRegistry = await OfferRegistry.new(nectarToken.address);
    const bountyRegistry = await BountyRegistry.new(nectarToken.address, ARBITER_VOTE_WINDOW, STAKE_DURATION);
    const net = new Net(new web3.providers.HttpProvider(uri));
    const chainId = await net.getId();    

    config[name] = {}    

    config[name].chain_id = chainId;
    config[name].eth_uri = uri;    
    config[name].nectar_token_address = nectarToken.address;
    config[name].bounty_registry_address = bountyRegistry.address;    
    config[name].offer_registry_address = offerRegistry.address;
    // TODO: get real address
    config[name].erc20_relay_address = '0x0000000000000000000000000000000000000000';
    
    if (options && options.free) {
      console.log("Setting gasPrice to 0 (Free to use.)");
      config[name].free = 'true';
    } else {
      config[name].free = 'false';
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
  }
};
