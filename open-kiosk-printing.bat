@echo off
rem Opens Chrome full-screen and prints WITHOUT the print dialog (for a counter PC with a USB thermal / laser printer).
rem Set the printer as the Windows default first.  Change the address if the server is on another computer.
start "" chrome --kiosk-printing --app=http://localhost:3000
