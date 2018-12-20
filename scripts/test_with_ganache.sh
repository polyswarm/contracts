#!/usr/bin/env bash

# start test blockchain
node ./node_modules/ganache-cli/build/cli.node.js --gasLimit 650000000 --gasPrice 0 --port 8545 >/dev/null 2>/dev/null &

# run linter
LINT_OUTPUT="$(node ./node_modules/solium/bin/solium.js -d contracts/)"
SOLIUM_EXIT_CODE=$?

if [ $SOLIUM_EXIT_CODE -eq 1 ]; then
    >&2 echo "Error while linting"
    >&2 echo $LINT_OUTPUT
    exit 1
fi

# check for warning message (solium exits zero on warnings)
echo $LINT_OUTPUT | grep "warning"

if [ $? -eq 0 ]; then
    >&2 echo "Warning while linting"
    >&2 echo $LINT_OUTPUT
    exit 1
elif [ $SOLIUM_EXIT_CODE -eq 0 ]; then
    # run unit tests
    truffle test
else
    >&2 echo "Solium exited with $SOLIUM_EXIT_CODE"
    >&2 echo $LINT_OUTPUT
    exit 1
fi
