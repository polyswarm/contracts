#! /bin/bash

if [ -z $LOG_FORMAT ]; then
  LOG_FORMAT='text'
fi

cd "${0%/*}"
truffle exec mint_tokens.js --log_format=$LOG_FORMAT
