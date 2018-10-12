const url = require('url');
const Net = require('web3-net');
const yaml = require('js-yaml');
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
const CONSUL_TIMEOUT = 5000; // time it takes for consul to timeout a request
const fs = require('fs');
const request = require('request-promise');
const headers = process.env.CONSUL_TOKEN ? { 'X-Consul-Token': process.env.CONSUL_TOKEN } : {};

// https://etherscan.io/token/0x9e46a38f5daabe8683e10793b06749eef7d733d1#readContract totalSupply
const TOTAL_SUPPLY = '1885913075851542181982426285';

// https://coinmarketcap.com/currencies/polyswarm/ retrieved on 5/28/18
const NCT_ETH_EXCHANGE_RATE = 80972;

// See docker setup
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

module.exports = async callback => {
  const config = {};

  if (!args.home || !args.side || !args.ipfs || !args.consul || !args['poly-sidechain-name']) {
    console.log('Usage: truffle exec create_config.js --home=<homechain_url> --side=<sidechain_url> --poly-sidechain-name=<name> --ipfs=<ipfs_url> --consul=<consul_url> --options=<options_path>');
    callback('missing args!!!');
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

  let options = null;
  const consulUrl = new url.parse(args.consul);
  const consul = require('consul')({ host: consulUrl.hostname, port: consulUrl.port, promisify: fromCallback, headers }, CONSUL_TIMEOUT);
  const consulBaseUrl = `chain/${args['poly-sidechain-name']}`;
  const configPath = 'config';

  if (args.options && fs.existsSync(args.options)) {
    try {
      options = yaml.safeLoad(fs.readFileSync(args.options, 'utf-8'));
    } catch (e) {
      console.error('Failied reading options');
      console.error(e);
      callback(e);
      process.exit(1);
    }
  }
  let response;

  try {
    response = await consul.kv.get(`${consulBaseUrl}/${configPath}`);
  } catch (e) {
    console.log(e);
    console.error(`Failed to connect to consul at ${consulBaseUrl}${configPath}`)
    process.exit(1);
  }

  const [chainConfig, resHeaders] = response;

  if (resHeaders.statusCode == 200) {
    console.error('Found unexpected existing consul config, bailing.');
    process.exit(1);
  } else if (resHeaders.statusCode == 500) {
    console.error('There was an internal consul error, bailing.');
    process.exit(1);
  } else if (resHeaders.statusCode == 404) {
      console.log('Didn\'t find consul config, proceeding.');
      console.log('Recieved status code error: ' + resHeaders.statusCode);
  }

  if (args.home) {
    console.log('running for homechain')
    try {
      await deployTo(args.home, 'homechain', options);
    } catch (e) {
      console.error('Failied on homechain');
      console.error(e);
      callback(e);
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
      callback(e);
      process.exit(1);
    }
  }

  console.log('New config created!');

  await putABI(NectarToken);
  await putABI(OfferRegistry);
  await putABI(BountyRegistry);
  await putABI(ArbiterStaking);
  await putABI(OfferLib);
  await putABI(OfferMultiSig);
  await putABI(ERC20Relay);
  await putChainConfig(configPath, config);
  // the script completes okay
  callback();

  async function putABI(artifact) {
    const { contractName, abi } = artifact._json;

    return await putConsul(`${consulBaseUrl}/${contractName}`, { abi }, `Error trying to PUT contract ABI at: ${consulBaseUrl}/${contractName}`);
  }

  async function putChainConfig(name, config) {
    return await putConsul(`${consulBaseUrl}/${name}`, config, `Error trying to PUT chain config at: ${consulBaseUrl}/${name}`);
  }

  async function putConsul(path, data, errorMessage) {
    let response;

    try {
      response = await consul.kv.set(path, JSON.stringify(data));
    } catch (e) {
      console.error(errorMessage);
      console.error(e);
      callback(e);
      process.exit(1);
    }

    const [success, resHeaders] = response;

    if (success) {
      return success;
    } else {
      console.error(errorMessage);
      console.error(resHeaders);
      callback(resHeaders);
      process.exit(1);
    }

  }

  console.log(options);
  async function deployTo(uri, name, options) {    
    NectarToken.setProvider(new web3.providers.HttpProvider(uri));
    OfferRegistry.setProvider(new web3.providers.HttpProvider(uri));
    BountyRegistry.setProvider(new web3.providers.HttpProvider(uri));
    ERC20Relay.setProvider(new web3.providers.HttpProvider(uri));

    const from = options && options[`${name}_contracts_owner`] ? options[`${name}_contracts_owner`] : web3.eth.coinbase || web3.eth.accounts[0];
    console.log(`Deploying contracts from: ${from}`);

    const nectarToken = await NectarToken.new({ from: from });
    const offerRegistry = await OfferRegistry.new(nectarToken.address, { from });
    const bountyRegistry = await BountyRegistry.new(nectarToken.address, ARBITER_VOTE_WINDOW, STAKE_DURATION, { from });
    
    const net = new Net(new web3.providers.HttpProvider(uri));
    const chainId = await net.getId();    
    const chainConfig = {};

    if (options.relay && name == 'homechain') {
      let erc20Relay = await ERC20Relay.new(nectarToken.address, NCT_ETH_EXCHANGE_RATE, options.relay.fee_wallet || ZERO_ADDRESS, options.relay.verifiers || [], { from });

      await nectarToken.mint(from, TOTAL_SUPPLY, { from });
      chainConfig.erc20_relay_address = erc20Relay.address;
    } else if (options.relay && name == 'sidechain') {
      let erc20Relay = await ERC20Relay.new(nectarToken.address, 0, ZERO_ADDRESS, options.relay.verifiers || [], { from });

      await nectarToken.mint(erc20Relay.address, TOTAL_SUPPLY, { from });
      chainConfig.erc20_relay_address = erc20Relay.address;
    } else {
      chainConfig.erc20_relay_address = ZERO_ADDRESS;
    }

    chainConfig.chain_id = chainId;
    chainConfig.eth_uri = uri;    
    chainConfig.nectar_token_address = nectarToken.address;
    chainConfig.bounty_registry_address = bountyRegistry.address;    
    chainConfig.offer_registry_address = offerRegistry.address;
    
    if (options && options.free) {
      console.log("Setting gasPrice to 0 (Free to use.)");
      chainConfig.free = 'true';
    } else {
      chainConfig.free = 'false';
    }

    await web3.eth.accounts.forEach(async account => {
      console.log('Minting tokens for ', account);
      await nectarToken.mint(account, web3.toWei(1000000000, 'ether'), { from });
    });

    await nectarToken.enableTransfers({ from });

    if (options && options.arbiters) {
      await Promise.all(options.arbiters
      .filter(arbiter => web3.isAddress(arbiter))
      .map(async arbiter => {
        console.log('Funding arbiter: '+ arbiter);
          await nectarToken.mint(arbiter, web3.toWei(1000000000, 'ether'), { from });
          console.log('Adding arbiter: ' + arbiter);
          console.log(await web3.eth.blockNumber);
          await bountyRegistry.addArbiter(arbiter, await web3.eth.blockNumber, { from });
      }));
    }

    if (options && options.accounts) {
      await Promise.all(options.accounts
      .filter(account => web3.isAddress(account))
      .map(async account => {
        console.log('Minting tokens for ', account);
        await nectarToken.mint(account, web3.toWei(1000000000, 'ether'), { from });
      }));
    }

    await putChainConfig(name, chainConfig);
  }
};

function fromCallback(fn) {
  return new Promise(function(resolve, reject) {
    try {
      return fn(function(err, data, res) {
        if (err) {
          err.res = res;
          return reject(err);
        }
        return resolve([data, res]);
      });
    } catch (err) {
      return reject(err);
    }
  });
}
