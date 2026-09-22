@echo off
setlocal
cd /d "%~dp0..\.."
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
mkdir build\phase5 2>nul
cl /nologo /EHsc /GR- /std:c++20 /W3 /I. /Febuild\phase5\phase5_tests.exe /Fobuild\phase5\ domain\fault\Fault.cpp tests\phase5\phase5_tests.cpp
exit /b %ERRORLEVEL%
