@echo off
echo Starting Electronic Parts Manager...

:: Start Backend Server
echo Starting Backend (localhost:3001)...
cd server
start "Backend Server" npm start
cd ..

:: Start Frontend Client
echo Starting Frontend (localhost:5173)...
cd client
start "Frontend Client" npm run dev
cd ..

echo ===================================================
echo Application is starting!
echo Backend logs will appear in a separate window.
echo Frontend logs will appear in a separate window.
echo Access the app at: http://localhost:5173
echo ===================================================
pause
