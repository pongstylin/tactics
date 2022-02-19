#!/bin/bash

TSC='node_modules/.bin/tsc'
WEBPACK='node_modules/.bin/webpack'

$TSC
NODE_ENV=beta $WEBPACK --config webpack.config.cjs
