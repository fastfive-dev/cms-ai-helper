#!/bin/bash
# cms-ai-helper 배포 스크립트
# 맥 미니 서버에서 실행하세요.
set -euo pipefail

echo "=== cms-ai-helper 배포 ==="

# 1. Docker 확인
if ! command -v docker &>/dev/null; then
  echo "❌ Docker가 설치되어 있지 않습니다."
  echo "   brew install --cask docker 로 설치 후 Docker Desktop을 실행하세요."
  exit 1
fi

if ! docker info &>/dev/null; then
  echo "❌ Docker Desktop이 실행 중이 아닙니다. 먼저 실행해주세요."
  exit 1
fi

echo "✓ Docker 확인 완료"

# 2. .env 파일 확인
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f .env ]; then
  echo ""
  echo "⚠ .env 파일이 없습니다. ANTHROPIC_API_KEY를 입력해주세요."
  read -rp "ANTHROPIC_API_KEY: " API_KEY
  echo "ANTHROPIC_API_KEY=${API_KEY}" > .env
  echo "✓ .env 파일 생성 완료"
else
  echo "✓ .env 파일 확인 완료"
fi

# 3. 기존 claude-serve launchd 서비스 중지
if launchctl list 2>/dev/null | grep -q "com.claude-serve"; then
  echo "기존 claude-serve launchd 서비스 중지 중..."
  launchctl bootout "gui/$(id -u)/com.claude-serve" 2>/dev/null || true
  echo "✓ 기존 서비스 중지 완료"
fi

# 4. 빌드 & 실행
echo ""
echo "Docker Compose 빌드 & 실행 중..."
docker compose down 2>/dev/null || true
docker compose up -d --build

echo ""
echo "=== 배포 완료 ==="
echo "  서버:        http://localhost:4098"
echo "  claude-serve: http://localhost:4097"
echo ""
echo "  로그 확인:   docker compose logs -f"
echo "  중지:        docker compose down"
