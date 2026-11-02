; Releases through 0.7.7 stored Viral Data inside $INSTDIR. Their uninstaller
; recursively removes that directory even with /KEEP_APP_DATA. Move only the
; named data folders to a sibling on the SAME volume before invoking it.
; Subsequent upgrades keep data outside $INSTDIR and preserve the pointer.
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "getProcessInfo.nsh"
Var pid

!ifndef BUILD_UNINSTALLER
Var viralDataLocation

Function PreserveViralData
  Exch $R8
  Push $R9
  Push $R7
  ${If} $R8 != ""
    GetFullPathName $R8 "$R8"
    ${If} ${FileExists} "$R8\Viral Data\*.*"
      StrCpy $R9 "$R8.data\Viral Data"
      ${If} ${FileExists} "$R9\*.*"
        MessageBox MB_OK|MB_ICONSTOP "Both old and preserved Viral Data folders exist. Setup stopped to keep both copies safe. Close Viral Studio and resolve the data folders before retrying." /SD IDOK
        SetErrorLevel 3
        Quit
      ${EndIf}
      CreateDirectory "$R8.data"
      ClearErrors
      Rename "$R8\Viral Data" "$R9"
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONSTOP "Cannot preserve Viral Data. Close the app and its DreamFace browsers, then retry. Your existing installation has not been removed." /SD IDOK
        SetErrorLevel 3
        Quit
      ${EndIf}
      ${If} $viralDataLocation == ""
        StrCpy $viralDataLocation "$R9"
      ${EndIf}
    ${ElseIf} ${FileExists} "$R8\data-location.txt"
      ClearErrors
      FileOpen $R7 "$R8\data-location.txt" r
      FileReadUTF16LE $R7 $R9
      FileClose $R7
      ${If} $viralDataLocation == ""
      ${AndIf} ${FileExists} "$R9\studio.json"
        StrCpy $viralDataLocation "$R9"
      ${EndIf}
    ${ElseIf} ${FileExists} "$R8.data\Viral Data\studio.json"
      ${If} $viralDataLocation == ""
        StrCpy $viralDataLocation "$R8.data\Viral Data"
      ${EndIf}
    ${EndIf}
    ; Legacy Dropship data can also be owned by an old Viral Studio install.
    ${If} ${FileExists} "$R8\Dropship Data\*.*"
      StrCpy $R9 "$R8.data\Dropship Data"
      ${If} ${FileExists} "$R9\*.*"
        MessageBox MB_OK|MB_ICONSTOP "Both old and preserved Dropship Data folders exist. Setup stopped without removing either copy." /SD IDOK
        SetErrorLevel 3
        Quit
      ${EndIf}
      CreateDirectory "$R8.data"
      ClearErrors
      Rename "$R8\Dropship Data" "$R9"
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONSTOP "Cannot preserve Dropship Data. Close all app browsers and retry. Setup stopped before removing the old installation." /SD IDOK
        SetErrorLevel 3
        Quit
      ${EndIf}
      ${If} $viralDataLocation == ""
        StrCpy $viralDataLocation "$R9"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $R7
  Pop $R9
  Pop $R8
FunctionEnd
!endif

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    ; This hook runs after the user selected a directory, immediately before
    ; uninstallOldVersion. Keep the standard builder process/close checks.
    ReadRegStr $R8 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    Push $R8
    Call PreserveViralData
    ${If} $installMode == "all"
      ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      Push $R8
      Call PreserveViralData
    ${EndIf}
    Push $INSTDIR
    Call PreserveViralData
  !endif
!macroend

!macro customInstall
  ${If} $viralDataLocation != ""
    FileOpen $R7 "$INSTDIR\data-location.txt" w
    FileWriteUTF16LE $R7 "$viralDataLocation"
    FileClose $R7
  ${EndIf}
!macroend
