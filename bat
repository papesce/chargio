#!/bin/bash
# Start/stop helper for Balanced Battery

PID_FILE="$(dirname "$0")/.battery.pid"

case "${1:-start}" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Already running (PID $(cat "$PID_FILE"))"
      exit 1
    fi
    python3 "$(dirname "$0")/battery_app.py" &
    echo $! > "$PID_FILE"
    echo "Started (PID $!) → http://127.0.0.1:8765"
    ;;
  stop)
    if [ ! -f "$PID_FILE" ]; then
      echo "Not running"
      exit 1
    fi
    PID=$(cat "$PID_FILE")
    if kill "$PID" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Stopped (PID $PID)"
    else
      rm -f "$PID_FILE"
      echo "Process $PID already gone"
    fi
    ;;
  kill)
    if [ ! -f "$PID_FILE" ]; then
      echo "Not running"
      exit 1
    fi
    PID=$(cat "$PID_FILE")
    if kill -9 "$PID" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Killed (PID $PID)"
    else
      rm -f "$PID_FILE"
      echo "Process $PID already gone"
    fi
    ;;
  restart)
    "$0" stop 2>/dev/null
    "$0" start
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Running (PID $(cat "$PID_FILE"))"
    else
      rm -f "$PID_FILE" 2>/dev/null
      echo "Not running"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|kill|restart|status}"
    exit 1
    ;;
esac
