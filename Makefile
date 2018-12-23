help:
	@echo "Available Commands"; \
	echo ""; \
	echo "install			Setup and install the app dependencies"; \
	echo "dev				Start the server and watch files for changes"; \
	echo "build				Build assets for production"; \
	echo "help				List available commands"

install:
	@echo "Installing dependencies..."; \
	npm install

dev: watch-server watch-client

build: build-client

start:
	@echo "Starting server..."; \
	export PORT=${PORT}; \
	npm start --prefix server

watch-server:
	@echo "Watching server..."; \
	export PORT=${PORT}; \
	npm run watch --prefix server

watch-client:
	@echo "Watching client..."; \
	export NODE_ENV=development; \
	npm run watch --prefix client

build-client:
	@echo "Building client..."; \
	export NODE_ENV=production; \
	npm run build --prefix client

.PHONY: install dev build start help
