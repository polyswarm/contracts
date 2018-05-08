module.exports = async callback => {
  const NectarToken = artifacts.require('NectarToken');
  var token = await NectarToken.deployed();

  await web3.eth.accounts.forEach(async account => {
    console.log('Minting tokens for ', account);
    await token.mint(account, web3.toWei(1000000000, 'ether'));
  });

  console.log('Enabling transfers');
  await token.enableTransfers().catch(e => {
    console.log("Already enabled");
  });

  callback();
};
