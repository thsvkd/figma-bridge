; Uninstall only: the app removes its own MCP entries (Claude Code, Claude Desktop, Codex).
; Turning the bridge off never touches them; this is the single place they are removed.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --cleanup'
    MessageBox MB_YESNO|MB_ICONQUESTION "런타임 데이터(로그, 설정)도 함께 삭제할까요?" /SD IDNO IDYES deleteData IDNO keepData
    deleteData:
      RMDir /r "$LOCALAPPDATA\FigmaBridge"
    keepData:
  ${endIf}
!macroend
