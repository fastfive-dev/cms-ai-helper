FROM node:18-alpine

# better-sqlite3 네이티브 빌드에 필요한 도구
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 의존성 설치 (캐시 레이어 활용)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 소스 복사
COPY . .

# SQLite 데이터 디렉토리
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=4098
EXPOSE 4098

CMD ["node", "index.js"]