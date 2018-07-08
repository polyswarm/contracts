#!/bin/bash
./scripts/wait_for_it.sh $geth:$port -t 0

echo "starting..."

truffle migrate --network development
truffle test --network development
