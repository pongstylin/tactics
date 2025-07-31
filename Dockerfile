FROM node:22-alpine AS builder
WORKDIR /app
COPY . .

RUN apk add --no-cache --virtual .gyp python3 make g++
RUN npm install
RUN npm run compile
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app ./

CMD ["node", "--es-module-specifier-resolution=node", "src/server.js"]