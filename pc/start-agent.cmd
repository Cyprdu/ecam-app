@echo off
rem Lance l'agent ECAM en arrière-plan (transcription + fiches).
cd /d "%~dp0"
start "" /min .venv\Scripts\pythonw.exe agent.py
