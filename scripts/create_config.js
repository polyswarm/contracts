const Net = require('web3-net');
const writeFile = require('write');
const args = require('args-parser')(process.argv);
const NectarToken = artifacts.require('NectarToken');
const OfferRegistry = artifacts.require("./OfferRegistry.sol");
const BountyRegistry = artifacts.require('BountyRegistry');
const ArbiterStaking = artifacts.require('ArbiterStaking');

const fs = require('fs');

module.exports = async callback => {
  const config = [];

  if (!args.home && !args.side) {
    console.log('Usage: truffle exec create_config.js --home=<homechain_url> --side=<sidechain_url> --ipfs=<ipfs_url> --arbiter=<arbiter_address>');
    return;
  }

  if (args.ipfs) {
    config.push(`ipfs_uri: ${args.ipfs}`)
  }

  if (args.home) {
    await deployTo(args.home, args.arbiter, 'homechain');
  }

  if (args.side) {
    await deployTo(args.side, args.arbiter, 'sidechain');
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

  async function deployTo(uri, arbiter, name) {
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

    await web3.eth.accounts.forEach(async account => {
      console.log('Minting tokens for ', account);
      await nectarToken.mint(account, web3.toWei(1000000000, 'ether'));
    });

    await nectarToken.enableTransfers();

    if (arbiter && web3.isAddress(arbiter)) {
      console.log('Setting arbiter to: ' + arbiter);
      console.log(await web3.eth.blockNumber);
      const arbiterStaking = ArbiterStaking.at(await bountyRegistry.staking());
      await nectarToken.approve(arbiterStaking.address, web3.toWei(10000000, 'ether'), { from: arbiter });
      console.log('Staking......')
      await arbiterStaking.deposit(web3.toWei(10000000, 'ether'), { from: arbiter });
      await bountyRegistry.addArbiter(arbiter, await web3.eth.blockNumber);
    }


  }
};
