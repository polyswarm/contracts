#! /bin/bash

MIN_GAS=6500000

get_all_unlocked() {
  curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"personal_listWallets","params":[],"id":1}' "$1" | grep -vq Locked
  return $?
}

wait_for_all_unlocked() {
  until get_all_unlocked "${HOME_CHAIN}"; do
    >&2 echo "Accounts are not unlocked on home chain sleeping..."
    sleep 1
  done

  until get_all_unlocked "${SIDE_CHAIN}"; do
    >&2 echo "Accounts are not unlocked on side chain sleeping..."
    sleep 1
  done
}

get_gas_limit() {
  curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["latest", true],"id":1}' "${HOME_CHAIN}" | \
    python -c "import sys, json; print(int(json.load(sys.stdin)['result']['gasLimit'], 0))"
}

wait_for_min_gas_limit() {
  gasLimit=$(get_gas_limit)

  until [[ $gasLimit -gt $MIN_GAS ]] ; do
    >&2 echo "Gas limit of ${gasLimit} is too low - sleeping..."
    sleep 1

    gasLimit=$(get_gas_limit)
  done
  >&2 echo "Gas limit (${gasLimit}) is high enough to deploy to!"
}

check_for_existing_abi() {

  STATUSCODE=$(curl --header $header -silent --output /dev/stderr --write-out "%{http_code}" "$CONSUL/v1/kv/chain/$POLY_SIDECHAIN_NAME/$1")
  if test $STATUSCODE -ne 200; then
    echo "Curl detected no consul key"
    return 1
  fi
  return 0

}

get_current_block() {
  curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":83}' "${HOME_CHAIN}" | \
    python -c "import sys, json; print(int(json.load(sys.stdin)['result'], 0)) if sys.stdin else 0"
}

wait_for_blocks() {
  block=$(get_current_block)
  next_block=$(($block + 1)) 
  sleep 1 # assuming one second blocks
  block=$(get_current_block)

  until [[ $block -gt next_block ]] ; do
    >&2 echo "Blocks not advancing yet, current block: ${block}. check sealers if this continues"
    sleep 1 # assuming one second blocks
    block=$(get_current_block)
  done
  >&2 echo "Blocks advancing okay"
}

wait_for_all_unlocked
wait_for_min_gas_limit
wait_for_blocks

# Replace with real argument parsing if we support other options later
if [[ $1 == "--idempotent" && -f "build/polyswarmd.yml" ]]; then
    >&2 echo "polyswarmd.yml detected in idempotent mode, exiting"
    exit
fi

if check_for_existing_abi "NectarToken" -a check_for_existing_abi "BountyRegistry" -a check_for_existing_abi "OfferRegistry" -a \
  check_for_existing_abi "OfferRegistry" -a check_for_existing_abi "OfferLib" -a check_for_existing_abi "OfferMultiSig" -a check_for_existing_abi "ArbiterStaking" -a \
  check_for_existing_abi "ERC20Relay"; then
    >&2 echo "ABIs already exist, skipping contract migration"
else
    truffle migrate --reset
fi

if [ $? -eq 1 ]; then
    exit 1
fi

if [ -z $LOG_FORMAT ]; then
  LOG_FORMAT='text'
fi

if [ -z $DB ]; then
    truffle exec scripts/create_config.js --home=$HOME_CHAIN --side=$SIDE_CHAIN --ipfs=$IPFS --consul=$CONSUL --poly-sidechain-name=$POLY_SIDECHAIN_NAME --log_format=$LOG_FORMAT --options=$OPTIONS
else
    truffle exec scripts/create_config.js --home=$HOME_CHAIN --side=$SIDE_CHAIN --ipfs=$IPFS --consul=$CONSUL --poly-sidechain-name=$POLY_SIDECHAIN_NAME --db=$DB --log_format=$LOG_FORMAT --options=$OPTIONS
fi
