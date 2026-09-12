!macro customUnInstall
  ${IfNot} ${isUpdated}
  ; Remove only this installation's literal hook command before deleting its runtime.
  nsExec::ExecToStack '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --interlude-uninstall'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK "Interlude could not remove its Codex hooks. Remove Interlude handlers from Codex /hooks after uninstalling. Other hooks were preserved."
  ${EndIf}
  ${EndIf}
!macroend
