#!/bin/bash

echo "Starting Electronic Parts Manager..."

# Function to kill child processes on exit
trap 'kill $(jobs -p)' EXIT

# Start Backend
echo "Starting Backend (localhost:3001)..."
cd server
npm start &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to initialize
sleep 2

# Start Frontend
echo "Starting Frontend (localhost:5173)..."
cd client
npm run dev &
FRONTEND_PID=$!
cd ..

echo "==================================================="
echo "Application is running!"
echo "Press Ctrl+C to stop both servers."
echo "==================================================="

# Keep script running to maintain processes
wait
