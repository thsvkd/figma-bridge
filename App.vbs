' figma-bridge launcher. Starts the GUI with no console window at all.
Option Explicit
Dim sh, fso, base, ps1, cmd, extra, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(base, "App.ps1")
If Not fso.FileExists(ps1) Then
  MsgBox "App.ps1 not found next to App.vbs.", 16, "Figma Bridge"
  WScript.Quit 1
End If
extra = ""
For i = 0 To WScript.Arguments.Count - 1
  extra = extra & " " & Chr(34) & WScript.Arguments(i) & Chr(34)
Next
cmd = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File " & Chr(34) & ps1 & Chr(34) & extra
sh.CurrentDirectory = base
sh.Run cmd, 0, False
