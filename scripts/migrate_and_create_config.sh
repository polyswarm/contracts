#! /bin/bash

MIN_GAS=5500000

get_all_unlocked() {
  curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"personal_listWallets","params":[],"id":1}' ${HOME_CHAIN} | grep -vq Locked
  return $?
}

wait_for_all_unlocked() {
  until get_all_unlocked; do
    >&2 echo "Accounts are not unlocked - sleeping..."
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

wait_for_all_unlocked
wait_for_min_gas_limit

truffle migrate --reset
truffle exec scripts/create_config.js --home=$HOME_CHAIN --side=$SIDE_CHAIN --ipfs=$IPFS --options=$OPTIONS
