const args = require('args-parser')(process.argv);
const rpc = require('ethrpc');
const Promise = require('bluebird');
const spawn = require('child-process-promise').spawn;
const headers = process.env.CONSUL_TOKEN ? { 'X-Consul-Token': process.env.CONSUL_TOKEN } : {};
const url = require('url');
const contractDiffExists = require('./contract_matcher');
const MIN_GAS = 6500000; // minimum gas needed on a block to deploy
const RETRY_WAITING_TIME = 1000; // waiting time between retries
const CONSUL_TIMEOUT = 5000; // time it takes for consul to timeout a request in seconds
const DEFAULT_TIMEOUT = 300000; // script timeout in milliseconds
const logger = require('./logger')(args.log_format);

rpc.connect = Promise.promisify(rpc.connect);
rpc.raw = Promise.promisify(rpc.raw);


module.exports = async callback => {
	if (!args.home || !args.side || !args.consul || !args['poly-sidechain-name']) {
		logger.info('Usage: truffle exec safe_mirgrate.js --home=<homechain_url> --side=<sidechain_url> --poly-sidechain-name=<name> --consul=<consul_url>');
		callback('missing args!!!');
		process.exit(1);
	}

	const timeout = typeof args.timeout === 'number' ? args.timeout : DEFAULT_TIMEOUT;

	setTimeout(() => {
		logger.error(`Script timeout after ${timeout} milliseconds`);
		process.exit(1);
	}, timeout);

	await checkGethDeployConditions(args.home);
	await checkGethDeployConditions(args.side);
	await migrateIfMissingABIOrConfig(args.consul);

	callback();
}

async function checkGethDeployConditions(chainUrl) {
	const connectionConfiguration = {
	  httpAddresses: [chainUrl],
  	  errorHandler: function (err) { /* out-of-band error */ }, // optional, used for errors that can't be correlated back to a request
	};

	try {
		await rpc.connect(connectionConfiguration);
	} catch (e) {
		logger.error({"message": `Error connecting to geth for: ${chainUrl}. ${e.message}`, "stack": e.stack});
		callback(`Error connecting to geth for: ${chainUrl}`);
		process.exit(1);
	}

	try {
		let wallets = await rpc.raw('personal_listWallets', null);

		while (!wallets.every(d => d.status == 'Unlocked')) {
			logger.info('Not Unlocked yet, waiting ...');
			await sleep(RETRY_WAITING_TIME);
			wallets = await rpc.raw("personal_listWallets", null);
		}
	} catch (e) {
		logger.error({"message": `Error getting wallets for: ${chainUrl}. ${e.message}`, "stack": e.stack});
		callback(`Error getting wallets for: ${chainUrl}`);
		process.exit(1);
	}

	logger.info('Accounts successfully unlocked...');

	try {
		let latestBlock = await web3.eth.getBlock('latest');
		let { gasLimit } = latestBlock;

		while (gasLimit < MIN_GAS) {
			logger.info('Gas is too low to deploy contracts');
			await sleep(RETRY_WAITING_TIME);
			latestBlock = await web3.eth.getBlock('latest');
			gasLimit = latestBlock.gasLimit;
		}
	} catch (e) {
		logger.error({"message": `Error checking gas limit for : ${chainUrl}. ${e.message}`, "stack": e.stack});
		callback(`Error checking gas limit for : ${chainUrl}`);
		process.exit(1);
	}

	logger.info('Gas is high enough to deploy contracts...');

	try {
		let latestBlock = await web3.eth.getBlock('latest');
		let { number: oldBlockNumber } = latestBlock;
		let latestBlockNumber = oldBlockNumber;

		while (latestBlockNumber == oldBlockNumber) {
			logger.info('Waiting for blocks to advance...');
			latestBlock = await web3.eth.getBlock('latest');
			latestBlockNumber = latestBlock.number;
			await sleep(RETRY_WAITING_TIME);
		}
	} catch (e) {
		logger.error({"message": `Error checking if blocks advancing: ${chainUrl}. ${e.message}`, "stack": e.stack});
		callback(`Error checking if blocks advancing: ${chainUrl}`);
		process.exit(1);
	}

	logger.info('Blocks advancing okay...');
}


async function migrateIfMissingABIOrConfig(consulConnectionURL) {
	const consulUrl = new url.parse(consulConnectionURL);
	const consul = require('consul')({ host: consulUrl.hostname, port: consulUrl.port, promisify: fromCallback, headers }, CONSUL_TIMEOUT);
	const paths = [ `/ArbiterStaking`,
	  `/BountyRegistry`,
	  `/ERC20Relay`,
	  `/NectarToken`,
	  `/OfferLib`,
	  `/OfferMultiSig`,
	  `/OfferRegistry`,
	  `/config`
	];
	let missingABIOrConfig = false;
	let consulBaseUrl = `chain/${args['poly-sidechain-name']}`;
	let response;

	for (let path of paths) {

		try {
			response = await consul.kv.get(`${consulBaseUrl}${path}`);
		} catch (e) {
			logger.error({"message": `Failed to connect to consul at ${consulBaseUrl}${path}. ${e.message}`, "stack": e.stack});
			process.exit(1);
		}

		const [contractABI, resHeaders] = response;

		if (resHeaders.statusCode == 500) {
			logger.error('500 Error from consul!!');
			process.exit(1);
		}

		if (resHeaders.statusCode == 404) {
			missingABIOrConfig = true;
			logger.error('Missing ABI of config for path: ' + path);
			break;
		}

		if (resHeaders.statusCode == 200) {
			logger.info('Found ABI or config at: ' + path);
		}

	}

	if (missingABIOrConfig 
		|| await contractDiffExists(args.consul, args.home, 'homechain', args['poly-sidechain-name'], headers)
		|| await contractDiffExists(args.consul, args.side, 'sidechain', args['poly-sidechain-name'], headers)) {
		try {
			const promise = spawn('truffle', ['migrate', '--reset']);
			const childProcess = promise.childProcess;
			 
			childProcess.stdout.on('data', function (data) {
			    logger.info(data.toString());
			});
			childProcess.stderr.on('data', function (data) {
			    logger.info(data.toString());
			});

			await promise;
		} catch (e) {
			logger.error({"message": `Error in truffle migrate!. ${e.message}`, "stack": e.stack});
			process.exit(1);
		}
	} else {
		logger.info('Already have config, ABIs, and no differnce in contracts found.');
		process.exit(2);
	}

	return;

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
