#!/bin/bash
# sleep to make sure accounts have finished unlocking (need a better way to do this)
sleep 5

# test
truffle test

# deploy to chain
truffle migrate --reset
