#! /bin/bash

truffle migrate --reset
truffle exec scripts/create_config.js --home=http://geth:8545 --side=http://sidechain:8545 --ipfs=http://ipfs:4001
