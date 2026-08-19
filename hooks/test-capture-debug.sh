#!/usr/bin/env bash
if [ -f /tmp/hook-captured ]; then exit 0; fi
touch /tmp/hook-captured
INPUT=$(cat)
echo "$INPUT" > /tmp/hook-input.json
