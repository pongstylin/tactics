#!/bin/bash

trap 'killAll' INT

killAll() {
  # Return a zero exit code even though we were interrupted.
  exit 0
}

WEBPACK='node_modules/.bin/webpack'
NODE='node'

# Uncomment this if you have trouble using Ctrl+C to shutdown server on windows.
#if command -v winpty &> /dev/null; then
#  NODE='winpty node'
#fi

STAMP=$(date "+%Y.%m.%d-%H.%M.%S")
# Wait for the node server to terminate
NODE_ENV=beta $NODE --es-module-specifier-resolution=node --require dotenv/config src/server.js > log/$STAMP.log 2>&1

# Stop all child processes like webpack and sed
kill -INT 0
