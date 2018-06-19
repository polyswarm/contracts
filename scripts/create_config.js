const Net = require('web3-net');
const writeFile = require('write');
const args = require('args-parser')(process.argv);
const NectarToken = artifacts.require('NectarToken');
const OfferRegistry = artifacts.require("./OfferRegistry.sol");
const BountyRegistry = artifacts.require('BountyRegistry');
const fs = require('fs');

module.exports = async callback => {
  const config = [];

  if (!args.home && !args.side) {
    console.log('Usage: truffle exec create_config.js --home=<homechain_url> --side=<sidechain_url> --ipfs=<ipfs_url>');
    return;
  }

  if (args.ipfs) {
    config.push(`ipfs_uri: ${args.ipfs}`)
  }

  if (args.home) {
    await deployTo(args.home, 'homechain');
  }

  if (args.side) {
    await deployTo(args.side, 'sidechain');
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

  async function deployTo(uri, name) {
    NectarToken.setProvider(new web3.providers.HttpProvider(uri));
    OfferRegistry.setProvider(new web3.providers.HttpProvider(uri));
    BountyRegistry.setProvider(new web3.providers.HttpProvider(uri));

    const nectarToken = await NectarToken.new();
    const offerRegistry = await OfferRegistry.new(nectarToken.address);
    const bountyRegistry = await BountyRegistry.new(nectarToken.address);
    const net = new Net(new web3.providers.HttpProvider(uri));
    const chainId = await net.getId();

    config.push(`${name}:`);
    config.push(`  chain_id: ${chainId}`)
    config.push(`  eth_uri: ${uri}`);
    config.push(`  nectar_token_address: "${nectarToken.address}"`);
    config.push(`  bounty_registry_address: "${bountyRegistry.address}"`);
    config.push(`  offer_registry_address: "${offerRegistry.address}"`);
    // TODO: get real address
    config.push(`  erc20_relay_address: "${'0x0000000000000000000000000000000000000000'}"`);
  }

};
