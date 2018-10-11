const args = require('args-parser')(process.argv);
const rpc = require('ethrpc');
const Promise = require('bluebird');
const spawn = require('child-process-promise').spawn;
const headers = process.env.CONSUL_TOKEN ? { 'X-Consul-Token': process.env.CONSUL_TOKEN } : {};
const url = require('url');
const MIN_GAS = 6500000; // minimum gas needed on a block to deploy
const RETRY_WAITING_TIME = 1000; // waiting time between retries
const CONSUL_TIMEOUT = 5000; // time it takes for consul to timeout a request 

rpc.connect = Promise.promisify(rpc.connect);
rpc.raw = Promise.promisify(rpc.raw);

if (!args.home || !args.side || !args.consul || !args['poly-sidechain-name']) {
	console.log('Usage: truffle exec safe_mirgrate.js --home=<homechain_url> --side=<sidechain_url> --poly-sidechain-name=<name> --consul=<consul_url>');
	callback('missing args!!!');
	process.exit(1);
}

module.exports = async callback => {

	await checkGethDeployConditions(args.home);
	await checkGethDeployConditions(args.side);
	await migrateIfMissingABI(args.consul);

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
		console.error(e);
		callback(`Error connecting to geth for: ${chainUrl}`);
		process.exit(1);
	}

	try {
		let wallets = await rpc.raw('personal_listWallets', null);

		while (!wallets.every(d => d.status == 'Unlocked')) {
			console.log('Not Unlocked yet, waiting ...');
			await sleep(RETRY_WAITING_TIME);
			wallets = await rpc.raw("personal_listWallets", null);
		}
	} catch (e) {
		console.error(e);
		callback(`Error getting wallets for: ${chainUrl}`);
		process.exit(1);
	}

	console.log('Accounts successfully unlocked...');

	try {
		let latestBlock = await web3.eth.getBlock('latest');
		let { gasLimit } = latestBlock;

		while (gasLimit < MIN_GAS) {
			console.log('Gas is too low to deploy contracts');
			await sleep(RETRY_WAITING_TIME);
			latestBlock = await web3.eth.getBlock('latest');
			gasLimit = latestBlock.gasLimit;
		}
	} catch (e) {
		console.error(e);
		callback(`Error checking gas limit for : ${chainUrl}`);
		process.exit(1);
	}

	console.log('Gas is high enough to deploy contracts...');

	try {
		let latestBlock = await web3.eth.getBlock('latest');
		let { number: oldBlockNumber } = latestBlock;
		let latestBlockNumber = oldBlockNumber;

		while (latestBlockNumber == oldBlockNumber) {
			console.log('Waiting for blocks to advance...');
			latestBlock = await web3.eth.getBlock('latest');
			latestBlockNumber = latestBlock.number;
			await sleep(RETRY_WAITING_TIME);
		}
	} catch (e) {
		console.error(e);
		callback(`Error checking if blocks advancing : ${chainUrl}`);
		process.exit(1);
	}

	console.log('Blocks advancing okay...');
}

async function migrateIfMissingABI(consulConnectionURL) {
	const consulUrl = new url.parse(consulConnectionURL);
	const consul = require('consul')({ host: consulUrl.hostname, port: consulUrl.port, promisify: fromCallback, headers }, CONSUL_TIMEOUT);
	const paths = [ `/ArbiterStaking`,
	  `/BountyRegistry`,
	  `/ERC20Relay`,
	  `/NectarToken`,
	  `/OfferLib`,
	  `/OfferMultiSig`,
	  `/OfferRegistry`
	];
	let missingABI = false;
	let consulBaseUrl = `chain/${args['poly-sidechain-name']}`;
	let response;

	for (let path of paths) {

		try {
			response = await consul.kv.get(`${consulBaseUrl}${path}`);
		} catch (e) {
			console.log(e);
			console.error(`Failed to connect to consul at ${consulBaseUrl}${path}`)
			process.exit(1);
		}

		const [contractABI, resHeaders] = response;

		if (resHeaders.statusCode == 500) {
			console.error('500 Error from consul!!');
			process.exit(1);
		}

		if (resHeaders.statusCode == 404) {
			missingABI = true;
			console.error('Missing abi for path: ' + path);
			break;
		}

		if (resHeaders.statusCode == 200) {
			console.log('Found ABI at: ' + path);
		}

	}

	if (missingABI) {
		try {
			const promise = spawn('truffle', ['migrate', '--reset']);
			const childProcess = promise.childProcess;
			 
			childProcess.stdout.on('data', function (data) {
			    console.log(data.toString());
			});
			childProcess.stderr.on('data', function (data) {
			    console.log(data.toString());
			});

			await promise;
		} catch (e) {
			console.error('error in truffle migrate!');
			console.error(e);
			process.exit(1);
		}
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
