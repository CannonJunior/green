#!/bin/bash

# Green - Personal AI Assistant
# Kills any running Green + Chew instances and restarts both

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

CHEW_DIR="/home/junior/src/chew"

echo -e "${BLUE}🌿 Green — Personal AI Assistant${NC}"
echo -e "${BLUE}===================================${NC}\n"

# --- Chew ---

echo -e "${BLUE}🍽️  Chew${NC}"
CHEW_PID=$(lsof -ti TCP:8983 -s TCP:LISTEN 2>/dev/null || true)
if [ -n "$CHEW_PID" ]; then
    echo -e "${YELLOW}🔪 Stopping Chew (PID: $CHEW_PID)...${NC}"
    kill "$CHEW_PID" 2>/dev/null || true
    sleep 2
    CHEW_PID=$(lsof -ti TCP:8983 -s TCP:LISTEN 2>/dev/null || true)
    if [ -n "$CHEW_PID" ]; then
        kill -9 "$CHEW_PID" 2>/dev/null || true
        sleep 1
    fi
    echo -e "${GREEN}✅ Chew stopped${NC}\n"
else
    echo -e "${GREEN}✅ Chew not running${NC}\n"
fi

echo -e "${GREEN}🚀 Starting Chew in background...${NC}"
(cd "$CHEW_DIR" && bash start.sh > /tmp/chew.log 2>&1) &
echo -e "${GREEN}✅ Chew starting (logs: /tmp/chew.log)${NC}\n"

# --- Green ---

echo -e "${BLUE}🌿 Green${NC}"
PIDS=$({ pgrep -f "tsx src/index.ts" 2>/dev/null; pgrep -f "node dist/index.js" 2>/dev/null; } | sort -u)
if [ -n "$PIDS" ]; then
    echo -e "${YELLOW}🔪 Stopping Green (PID: $PIDS)...${NC}"
    echo "$PIDS" | xargs kill 2>/dev/null || true
    sleep 2
    PIDS=$({ pgrep -f "tsx src/index.ts" 2>/dev/null; pgrep -f "node dist/index.js" 2>/dev/null; } | sort -u)
    if [ -n "$PIDS" ]; then
        echo "$PIDS" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
    echo -e "${GREEN}✅ Green stopped${NC}\n"
else
    echo -e "${GREEN}✅ Green not running${NC}\n"
fi

# Load .env
if [ -f .env ]; then
    set -o allexport
    # shellcheck disable=SC1091
    source .env
    set +o allexport
    echo -e "${GREEN}✅ Loaded .env${NC}\n"
else
    echo -e "${RED}❌ No .env file found${NC}"
    exit 1
fi

echo -e "${GREEN}🚀 Starting Green...${NC}"
echo -e "${BLUE}===================================${NC}\n"

npm run dev
