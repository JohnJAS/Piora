param(
  [Parameter(Mandatory)] [int] $BrowserProcess,
  [Parameter(Mandatory)] [ValidateSet('open','cancel-print','print-pdf','save-pdf')] [string] $Operation,
  [Parameter(Mandatory)] [string] $FixtureDirectory,
  [string] $FixtureFile
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PioraMenuDialogOwner {
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
}
'@
if ($FixtureFile) {
  $root = [IO.Path]::GetFullPath($FixtureDirectory).TrimEnd('\') + '\'
  $path = [IO.Path]::GetFullPath($FixtureFile)
  if (!$path.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) { throw 'Expected a file in the isolated fixture directory.' }
}
$owned = [Collections.Generic.HashSet[int]]::new()
function RefreshProcessTree {
  $owned.Clear()
  $todo = [Collections.Generic.Queue[int]]::new()
  $todo.Enqueue($BrowserProcess)
  while ($todo.Count) {
    $next = $todo.Dequeue()
    if (!$owned.Add($next)) { continue }
    foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $next" -Property ProcessId)) {
      $todo.Enqueue([int]$child.ProcessId)
    }
  }
}
function OwnedWindow($window) {
  if ($owned.Contains([int]$window.Current.ProcessId)) {return $true}
  $handle = [IntPtr] $window.Current.NativeWindowHandle
  for ($i=0; $handle -ne [IntPtr]::Zero -and $i -lt 12; $i++) {
    [int] $ownerProcess = 0
    [void][PioraMenuDialogOwner]::GetWindowThreadProcessId($handle,[ref]$ownerProcess)
    if ($owned.Contains($ownerProcess)) {return $true}
    $handle = [PioraMenuDialogOwner]::GetWindow($handle,4)
  }
  return $false
}
function ClickButton($element) {
  $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
}
$scope = [System.Windows.Automation.TreeScope]
$trueCondition = [System.Windows.Automation.Condition]::TrueCondition
$windowCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Window)
$until = (Get-Date).AddSeconds(35)
$observed = @()
$ownedTitles = [Collections.Generic.HashSet[string]]::new()
$refreshAt = [datetime]::MinValue
while ((Get-Date) -lt $until) {
  if ((Get-Date) -ge $refreshAt) {
    RefreshProcessTree
    $refreshAt = (Get-Date).AddSeconds(3)
  }
  $windows = [Collections.Generic.List[System.Windows.Automation.AutomationElement]]::new()
  foreach ($rootWindow in [System.Windows.Automation.AutomationElement]::RootElement.FindAll($scope::Children,$trueCondition)) {
    if (!(OwnedWindow $rootWindow)) { continue }
    $windows.Add($rootWindow)
    foreach ($nested in $rootWindow.FindAll($scope::Descendants,$windowCondition)) { $windows.Add($nested) }
  }
  foreach ($window in $windows) {
    try {
      $title = $window.Current.Name
      [void]$ownedTitles.Add(($window.Current.ClassName + "/" + $title))
      if ($Operation -eq 'open') { $wanted = $title -match '^(Open|打开|选择文件)' }
      elseif ($Operation -eq 'save-pdf') { $wanted = $title -match 'Save.*(Output|As)|另存为|保存打印输出|将打印输出' }
      else { $wanted = $title -match '^(Print|打印)(?:$|[ ·\-:：])' }
      if (!$wanted) { continue }
      $all = @($window.FindAll($scope::Descendants,$trueCondition))
      $observed = @($all | Where-Object {$_.Current.ControlType -in @([System.Windows.Automation.ControlType]::Edit,[System.Windows.Automation.ControlType]::ComboBox) -or $_.Current.AutomationId -in @('1','2','1148','1001')} | ForEach-Object {$_.Current.AutomationId + '/' + $_.Current.ControlType.ProgrammaticName + '/enabled=' + $_.Current.IsEnabled})
      $buttons = @($all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.IsEnabled})
      if ($Operation -eq 'cancel-print') {
        $button = $buttons | Where-Object { $_.Current.AutomationId -eq '2' -or $_.Current.Name -match 'Cancel|取消' } | Select-Object -First 1
        if ($button) { ClickButton $button; return }
      } elseif ($Operation -eq 'print-pdf') {
        $printer = $all | Where-Object {$_.Current.Name -eq 'Microsoft Print to PDF'} | Select-Object -First 1
        if (!$printer) {
          $combo = $all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox -and ($_.Current.Name -match 'printer|打印机|name|名称' -or $_.Current.AutomationId -eq '1139')} | Select-Object -First 1
          if ($combo) {
            $expand = $null
            if ($combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$expand)) { $expand.Expand() }
          }
          continue
        }
        $select = $null
        if ($printer.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$select)) {
          $select.Select()
          if (!$select.Current.IsSelected) {continue}
        } else {
          $currentPrinter = $all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox -and $_.Current.Name -eq 'Microsoft Print to PDF'}
          if (!$currentPrinter) {continue}
        }
        $button = $buttons | Where-Object {$_.Current.AutomationId -eq '1' -or $_.Current.Name -match '^(Print|打印)(\(&?.\))?$'} | Select-Object -First 1
        if ($button) { ClickButton $button; return }
      } else {
        $edit = $all | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and ($_.Current.AutomationId -in @('1148','1001') -or $_.Current.Name -match 'File name|文件名') } | Select-Object -First 1
        if (!$edit) {
          $comboHandle = [PioraMenuDialogOwner]::GetDlgItem([IntPtr]$window.Current.NativeWindowHandle,1148)
          if ($comboHandle -ne [IntPtr]::Zero) {
            $combo = [System.Windows.Automation.AutomationElement]::FromHandle($comboHandle)
            $edit = $combo.FindFirst($scope::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit))
            if (!$edit) {$edit = $combo}
          }
        }
        $value = $null
        if (!$edit -or !$edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$value)) {continue}
        if ($value.Current.Value -ne $path) {$value.SetValue($path)}
        $button = $all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and ($_.Current.AutomationId -eq '1' -or $_.Current.Name -match '^(Open|打开|Save|保存)(\(&?.\))?$')} | Select-Object -First 1
        if ($button -and $button.Current.IsEnabled) {ClickButton $button; return}
      }
    } catch [System.Windows.Automation.ElementNotAvailableException] { continue }
  }
  Start-Sleep -Milliseconds 180
}
throw ("Fixture-owned dialog unavailable for " + $Operation + ". Owned windows: " + ($ownedTitles -join ', ') + ". Controls: " + ($observed -join ', '))
