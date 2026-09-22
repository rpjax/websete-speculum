@echo off
setlocal
cd /d "%~dp0..\.."
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
mkdir build\phase4 2>nul
cl /nologo /EHsc /GR- /std:c++20 /W3 /I. /Febuild\phase4\phase4_tests.exe /Fobuild\phase4\ domain\fault\Fault.cpp tests\phase4\phase4_tests.cpp
exit /b %ERRORLEVEL%
