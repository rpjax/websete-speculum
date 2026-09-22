@echo off
setlocal
cd /d "%~dp0..\.."
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
mkdir build\phase6 2>nul

rem A5: reconstructor unit — must not pull engines/sim
cl /nologo /EHsc /GR- /std:c++20 /W3 /I. /Febuild\phase6\reconstructor_unit.exe /Fobuild\phase6\ tests\phase6\reconstructor_unit.cpp
if errorlevel 1 exit /b 1

cl /nologo /EHsc /GR- /std:c++20 /W3 /I. /Febuild\phase6\phase6_tests.exe /Fobuild\phase6\ domain\fault\Fault.cpp tests\phase6\phase6_tests.cpp
exit /b %ERRORLEVEL%
