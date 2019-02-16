FROM node:latest

WORKDIR /var/www/server

COPY package*.json ./

RUN npm install

RUN node_modules/.bin/sequelize db:migrate
