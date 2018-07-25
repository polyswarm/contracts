const Net = require('web3-net');
const writeFile = require('write');
const yaml = require('js-yaml')
const args = require('args-parser')(process.argv);
const NectarToken = artifacts.require('NectarToken');
const OfferRegistry = artifacts.require('OfferRegistry');
const BountyRegistry = artifacts.require('BountyRegistry');
const ArbiterStaking = artifacts.require('ArbiterStaking');
const ARBITER_VOTE_WINDOW = 100;
const STAKE_DURATION = 100;
const fs = require('fs');

module.exports = async callback => {
  const config = [];

  if (!args.home && !args.side) {
    console.log('Usage: truffle exec create_config.js --home=<homechain_url> --side=<sidechain_url> --ipfs=<ipfs_url> --options=<options_path>');
    return;
  }

  if (args.ipfs) {
    config.push(`ipfs_uri: ${args.ipfs}`);
  }

  let options = null
  if (args.options && fs.existsSync(args.options)) {
    options = yaml.safeLoad(fs.readFileSync(args.options, 'utf-8'));
  }

  if (options && options.free) {
    console.log("Setting gasPrice to 0 (Free to use.)");
    config.push('free: Yes');
  } else {
    config.push('free: No');
  }

  if (args.home) {
    await deployTo(args.home, 'homechain', options);
  }

  if (args.side) {
    // Extra user accounts on the sidechain shouldn't be pre-funded. All funding should happen through a relay.
    await deployTo(args.side, 'sidechain', null);
  }

  writeFile(`${__dirname}/../build/polyswarmd.yml`, config.join('\n'), function(err) {
    if (err) console.log(err);
    console.log('New config created!');
    writeFile(`${__dirname}/../build/.ready`, '', function(err) {
      if (err) console.log(err);
      setTimeout(() => {
        fs.unlinkSync(`${__dirname}/../build/.ready`);
      }, 2000);
    });
  });

  callback();

  async function deployTo(uri, name, options) {
    NectarToken.setProvider(new web3.providers.HttpProvider(uri));
    OfferRegistry.setProvider(new web3.providers.HttpProvider(uri));
    BountyRegistry.setProvider(new web3.providers.HttpProvider(uri));

    const nectarToken = await NectarToken.new();
    const offerRegistry = await OfferRegistry.new(nectarToken.address);
    const bountyRegistry = await BountyRegistry.new(nectarToken.address, ARBITER_VOTE_WINDOW, STAKE_DURATION);
    const net = new Net(new web3.providers.HttpProvider(uri));
    const chainId = await net.getId();

    config.push(`${name}:`);
    config.push(`  chain_id: ${chainId}`);
    config.push(`  eth_uri: ${uri}`);
    config.push(`  nectar_token_address: "${nectarToken.address}"`);
    config.push(`  bounty_registry_address: "${bountyRegistry.address}"`);
    config.push(`  offer_registry_address: "${offerRegistry.address}"`);
    // TODO: get real address
    config.push(`  erc20_relay_address: "${'0x0000000000000000000000000000000000000000'}"`);

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
