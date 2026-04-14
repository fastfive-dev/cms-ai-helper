FROM node:18-alpine

RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@8

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY . .

ENV CLAUDE_SERVE_PORT=4097
EXPOSE 4097

CMD ["node", "server.js"]
