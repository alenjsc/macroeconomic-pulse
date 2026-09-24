@echo off
title Macro Dashboard - Live Data Refresh
echo ========================================================
echo   MACROECONOMIC INDICATORS DASHBOARD - DATA REFRESH
echo ========================================================
echo.
echo Checking Python environment...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not found in PATH. Please ensure Python 3 is installed.
    pause
    exit /b 1
)

echo Fetching latest official macro indicators...
echo 1. US Treasury Yield Curve (home.treasury.gov)
echo 2. US Inflation CPI and Core (Bureau of Labor Statistics)
echo 3. India Inflation CPI, CFPI and WPI (MoSPI / RBI)
echo 4. Currencies, Equities and Commodities (Yahoo Finance)
echo.

cd /d "%~dp0"
python fetch_data.py

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo [SUCCESS] Macro data refreshed successfully!
    echo Refresh or reopen index.html in your browser to view updates.
    echo ========================================================
) else (
    echo.
    echo [ERROR] Data refresh encountered an issue. See details above.
)

echo.
ping 127.0.0.1 -n 4 >nul
