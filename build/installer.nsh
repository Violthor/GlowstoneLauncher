; Assisted (wizard) installer. Shortcuts are created by electron-builder's own
; optional tasks according to the user's checkboxes (desktop / start menu), so we
; must NOT force-create them here.

; customInit runs BEFORE installApplicationFiles extracts app-64.7z. We must kill
; any running instance here: if the app is still running when files are extracted,
; the locked app.asar fails to be replaced while the installer still reports
; success — the user then keeps the old build (this was the root cause of the
; sponsor/community edition appearing "not updated").
!macro customInit
  SetShellVarContext current
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  Pop $0
!macroend

; Belt-and-suspenders: also kill right after files are laid down and before any
; auto-launch, so no stale in-memory process can survive an upgrade.
!macro customInstall
  SetShellVarContext current
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  Pop $0
!macroend

; On uninstall: stop the app and clean up the desktop shortcut if it exists.
!macro customUnInstall
  SetShellVarContext current
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  Pop $0
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
