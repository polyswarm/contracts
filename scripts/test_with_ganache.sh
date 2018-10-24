#!/usr/bin/env bash

node ./node_modules/ganache-cli/build/cli.node.js --quiet --gasLimit 650000000 --gasPrice 0 >/dev/null 2>/dev/null &
truffle test
