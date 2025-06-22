#!/bin/sh

npm install
npm run compile

echo "Building assets and watching for file changes..."
npm run watch &

echo "Starting app..."
# Wait for the node server to terminate
exec node --es-module-specifier-resolution=node --require dotenv/config src/server.js
