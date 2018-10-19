const args = require('args-parser')(process.argv);
const logger = require('./logger')(args.log_format);
logger.info(`Logging format: ${args.log_format || 'text'}`);

module.exports = async callback => {
  const NectarToken = artifacts.require('NectarToken');
  var token = await NectarToken.deployed();

  await web3.eth.accounts.forEach(async account => {
    logger.info('Minting tokens for ' + account);
    await token.mint(account, web3.toWei(1000000000, 'ether'));
  });

  logger.info('Enabling transfers');
  await token.enableTransfers().catch(e => {
    logger.info("Already enabled");
  });

  callback();
};
