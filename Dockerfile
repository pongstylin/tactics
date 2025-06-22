FROM node:22-alpine

WORKDIR /app
COPY . .

RUN npm install
RUN npm run compile

EXPOSE 2000

# Define the command to run your application
CMD ["node", "--es-module-specifier-resolution=node", "--require dotenv/config", "src/server.js"]
