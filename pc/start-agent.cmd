@echo off
rem Lance l'agent ECAM en arrière-plan (transcription + fiches). --supervise : relancé tout seul s'il s'arrête.
cd /d "%~dp0"
start "" /min .venv\Scripts\pythonw.exe agent.py --supervise
