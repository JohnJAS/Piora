!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Function PioraFindRunningApp
      Push $0
      Push $1
      Push $2
      System::Call 'kernel32::GetCurrentProcessId() i .r0'
      System::Call 'kernel32::ProcessIdToSessionId(i r0, *i .r1) i .r2'
      ${If} $2 != 0
        nsExec::ExecToStack /TIMEOUT=5000 '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FI "SESSION eq $1" /FI "PID ne $0" /FO CSV /NH'
        Pop $1
        Pop $2
        ${If} $1 == 0
          StrLen $0 '$\"${APP_EXECUTABLE_FILENAME}$\",'
          StrCpy $2 $2 $0
        ${Else}
          StrCpy $2 ""
        ${EndIf}
      ${Else}
        StrCpy $2 ""
      ${EndIf}
      StrCpy $0 0
      ${If} $2 == '$\"${APP_EXECUTABLE_FILENAME}$\",'
        StrCpy $0 1
      ${EndIf}
      Pop $2
      Pop $1
      Exch $0
    FunctionEnd

    Function PioraEnsureAppExited
      ${If} ${Silent}
      ${OrIf} ${isUpdated}
        Return
      ${EndIf}

      Push $0
      piora_retry:
        Call PioraFindRunningApp
        Pop $0
        ${If} $0 == 1
          ${If} $LANGUAGE == 2052
            StrCpy $0 "${PRODUCT_NAME} 仍在运行。请先保存工作，右键点击任务栏右下角的应用图标，选择“彻底退出”，再点“重试”。点“取消”可停止安装。"
          ${ElseIf} $LANGUAGE == 1028
            StrCpy $0 "${PRODUCT_NAME} 仍在執行。請先儲存工作，在工作列右下角的通知區域圖示選單中選擇「結束」，再按「重試」。按「取消」可停止安裝。"
          ${Else}
            StrCpy $0 "${PRODUCT_NAME} is still running. Save your work, then right-click its notification area icon, choose Quit, and click Retry. Click Cancel to stop setup without installing."
          ${EndIf}
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_SETFOREGROUND "$0" /SD IDCANCEL IDRETRY piora_retry
          SetErrorLevel 1
          Quit
        ${EndIf}
      Pop $0
    FunctionEnd
  !endif
!macroend

!macro customInit
  Call PioraEnsureAppExited
!macroend

!macro customPageAfterChangeDir
  !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
    !define PIORA_DEFAULT_INSTFILES_PRE "${MUI_PAGE_CUSTOMFUNCTION_PRE}"
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_PRE PioraCheckBeforeInstall
  Function PioraCheckBeforeInstall
    !ifdef PIORA_DEFAULT_INSTFILES_PRE
      Call ${PIORA_DEFAULT_INSTFILES_PRE}
      !undef PIORA_DEFAULT_INSTFILES_PRE
    !endif
    Call PioraEnsureAppExited
  FunctionEnd
!macroend
