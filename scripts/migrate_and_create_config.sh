#! /bin/bash
if [ -z $LOG_FORMAT ]; then
  LOG_FORMAT='text'
fi

truffle exec scripts/safe_migrate.js --home=$HOME_CHAIN --side=$SIDE_CHAIN --consul=$CONSUL --poly-sidechain-name=$POLY_SIDECHAIN_NAME --log_format=$LOG_FORMAT --timeout=$TIMEOUT
migration_exit_code=$?

if [ $migration_exit_code -eq 1 ]; then
    exit 1
elif [ $migration_exit_code -eq 2 ]; then
    >&2 echo "Existing ABIs and config - skipping create_config.js"
    exit 0
fi

if [ -z $DB ]; then
    truffle exec scripts/create_config.js --home=$HOME_CHAIN --side=$SIDE_CHAIN --ipfs=$IPFS --consul=$CONSUL --poly-sidechain-name=$POLY_SIDECHAIN_NAME --log_format=$LOG_FORMAT --options=$OPTIONS --timeout=$TIMEOUT
else
    truffle exec scripts/create_config.js --home=$HOME_CHAIN --side=$SIDE_CHAIN --ipfs=$IPFS --consul=$CONSUL --poly-sidechain-name=$POLY_SIDECHAIN_NAME --db=$DB --log_format=$LOG_FORMAT --options=$OPTIONS --timeout=$TIMEOUT
fi
