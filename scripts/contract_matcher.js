const bytecodeUtils = require('bytecode-utils');
const fs = require('fs');
const url = require('url');
const path = require('path');
const truffleFlattener = require('truffle-flattener');

module.exports = async (consulConnectionURL, chainUrl, chainName, polySidechainName, headers = {}) => {
	const consulBaseUrl = `chain/${polySidechainName}`;
	const consulUrl = new url.parse(consulConnectionURL);
	const consul = require('consul')({ host: consulUrl.hostname, port: consulUrl.port, promisify: fromCallback, headers });
	let response;

	try {
		response = await consul.kv.get(`${consulBaseUrl}/${chainName}`);
	} catch (e) {
		console.log(e);
		console.error(`Failed to connect to consul at ${consulBaseUrl}${configPath}`)
		process.exit(1);
	}

	const [chainConfig, resHeaders] = response;

	if (resHeaders.statusCode !== 200 && resHeaders.statusCode !== 404) {
		console.error(`Recieved status code error: ${resHeaders.statusCode}, bailing.`);
		process.exit(1);
	} else if (resHeaders.statusCode === 404) {
		console.log('Didn\'t find consul config, proceeding.');
		console.log('Recieved status code error: ' + resHeaders.statusCode);
		return true;
	}

	const config = JSON.parse(chainConfig.Value);

	console.log(`Checking for difference in contracts on ${chainName}`);

	let results = await Promise.all([doesMatchExist(chainUrl, 'NectarToken', config.nectar_token_address),
		doesMatchExist(chainUrl, 'BountyRegistry', config.bounty_registry_address),
		doesMatchExist(chainUrl, 'OfferRegistry', config.offer_registry_address),
		doesMatchExist(chainUrl, 'ERC20Relay', config.erc20_relay_address)
	]);

	if (results.some(isMatchingBytecode => !isMatchingBytecode)) {
		console.log(`Contract difference found in bytecode on ${chainName}`);
		return true;
	}

	console.log(`No difference in contracts on ${chainName}`);
	return false;
}

async function doesMatchExist(gethURL, contractName, contractAddress) {
	const utils = bytecodeUtils.init(gethURL);
	const importedContracts = ['ArbiterStaking', 'NectarToken', 'OfferMultiSig', 'OfferLib'];
	const contractToImportPaths = importedContracts.map(c => path.resolve(`../contracts/${c}.sol`));
	const contractPath = path.resolve(`../contracts/${contractName}.sol`);

	try {
		const flattened = await truffleFlattener([contractPath, ...contractToImportPaths]);
		const { match, msg } = await utils.compareBytecode(contractAddress, 'latest', flattened, contractName);
		console.log(`${contractName}:`);
		console.log(msg);

		return match;
	} catch (e) {
		console.error('Error comparing bytecode');	
		console.error(e);
		process.exit(1);
	}
}

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
