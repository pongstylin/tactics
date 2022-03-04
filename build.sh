#!/bin/bash

TSC='node_modules/.bin/tsc'
WEBPACK='node_modules/.bin/webpack'

cp .env-betta .env

$TSC
NODE_ENV=beta $WEBPACK --config webpack.config.cjs
