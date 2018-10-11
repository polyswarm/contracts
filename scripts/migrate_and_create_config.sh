#! /bin/bash

truffle exec scripts/safe_migrate.js --home=$HOME_CHAIN --side=$SIDE_CHAIN --consul=$CONSUL --poly-sidechain-name=$POLY_SIDECHAIN_NAME

if [ $? -eq 1 ]; then
    exit 1
fi

if [ -z $DB ]; then
    truffle exec scripts/create_config.js --home=$HOME_CHAIN --side=$SIDE_CHAIN --ipfs=$IPFS --consul=$CONSUL --poly-sidechain-name=$POLY_SIDECHAIN_NAME --options=$OPTIONS
else
    truffle exec scripts/create_config.js --home=$HOME_CHAIN --side=$SIDE_CHAIN --ipfs=$IPFS --consul=$CONSUL --poly-sidechain-name=$POLY_SIDECHAIN_NAME --db=$DB --options=$OPTIONS
fi
