#!/bin/bash

cd "$(dirname "$0")"

# Test 1: 启动和基本命令
echo "=== Test 1: Basic Commands ==="
(echo "/tasks"; sleep 1; echo "/inbox"; sleep 1; echo "/compact"; sleep 1; echo "exit") | npm run full-agent 2>&1

echo -e "\n=== Test 2: User Query ==="
(echo "Hello, can you help me?"; sleep 2; echo "exit") | npm run full-agent 2>&1

echo -e "\n=== Tests Complete ==="
