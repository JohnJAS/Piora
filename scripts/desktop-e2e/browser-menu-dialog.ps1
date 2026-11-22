param(
  [Parameter(Mandatory)] [int] $BrowserProcess,
  [Parameter(Mandatory)] [ValidateSet('open','prepare-print','cancel-print','print-pdf','save-pdf')] [string] $Operation,
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
  [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
  private delegate bool VisitControl(IntPtr handle, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, VisitControl visit, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr handle, System.Text.StringBuilder name, int capacity);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr SendMessageTimeout(IntPtr handle, uint message, IntPtr size, string text, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr SendMessageTimeout(IntPtr handle, uint message, IntPtr size, System.Text.StringBuilder text, uint flags, uint timeout, out IntPtr result);
  private static string WindowClass(IntPtr window) {
    var name = new System.Text.StringBuilder(64);
    GetClassName(window, name, name.Capacity);
    return name.ToString();
  }
  private static bool InFilenameField(IntPtr edit, IntPtr dialog) {
    for (IntPtr window = edit; window != dialog && window != IntPtr.Zero; window = GetParent(window)) {
      int id = GetDlgCtrlID(window);
      if (id == 1001 || id == 1148) return true;
    }
    return false;
  }
  public static bool SetFixtureFilename(IntPtr dialog, string path) {
    var fields = new System.Collections.Generic.List<IntPtr>();
    EnumChildWindows(dialog, (handle, _) => {
      if (WindowClass(handle) == "Edit" && IsWindowVisible(handle) && IsWindowEnabled(handle) && InFilenameField(handle, dialog)) fields.Add(handle);
      return true;
    }, IntPtr.Zero);
    if (fields.Count != 1) return false;
    IntPtr edit = fields[0];
    IntPtr result;
    if (SendMessageTimeout(edit, 0x000C, IntPtr.Zero, path, 2, 1500, out result) == IntPtr.Zero) return false;
    var selected = new System.Text.StringBuilder(path.Length + 2);
    return SendMessageTimeout(edit, 0x000D, (IntPtr)selected.Capacity, selected, 2, 1500, out result) != IntPtr.Zero && selected.ToString() == path;
  }
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
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
# The Windows print broker can own its own top-level window. Only an explicitly
# requested acceptance run on a disposable hosted machine may address that broker.
$hostedPrint = $env:PIORA_CI_BROWSER_ACCEPTANCE -eq '1' -and $env:RUNNER_ENVIRONMENT -eq 'github-hosted' -and $env:GITHUB_ACTIONS -eq 'true' -and $Operation -ne 'open'
$inspectPrint = $Operation -in @('prepare-print','cancel-print','print-pdf')
if ($inspectPrint) {
  Add-Type -Path (Join-Path $PSScriptRoot 'windows-print-frame.cs')
  $frameFile = Join-Path $FixtureDirectory "visible-print-frames-$BrowserProcess.json"
  if ($Operation -eq 'prepare-print') {
    $baseline = @{ frames = @([PioraPrintFrame]::FrameHandles($false)); proxies = @([PioraPrintFrame]::VisibleProxies()) }
    ConvertTo-Json -InputObject $baseline -Compress | Set-Content -LiteralPath $frameFile
    return
  }
  # Windows PowerShell 5 returns the JSON array as one pipeline object.
  # Enumerate the parsed value explicitly before converting its entries.
  $baseline = Get-Content -Raw -LiteralPath $frameFile | ConvertFrom-Json
  [long[]] $previousFrames = @()
  foreach ($frame in $baseline.frames) { $previousFrames += [long]$frame }
  [long[]] $previousProxies = @()
  foreach ($proxy in $baseline.proxies) { $previousProxies += [long]$proxy }
  $image = (Get-Process -Id $BrowserProcess).MainModule.FileVersionInfo
  $appNames = @($image.ProductName,$image.FileDescription,[IO.Path]::GetFileNameWithoutExtension($image.FileName)) | Where-Object {$_}
}
$until = (Get-Date).AddSeconds(35)
$observed = @()
$ownedTitles = [Collections.Generic.HashSet[string]]::new()
$printOutputWindows = [Collections.Generic.HashSet[string]]::new()
$refreshAt = [datetime]::MinValue
while ((Get-Date) -lt $until) {
  if ((Get-Date) -ge $refreshAt) {
    RefreshProcessTree
    $refreshAt = (Get-Date).AddSeconds(3)
  }
  $windows = [Collections.Generic.List[System.Windows.Automation.AutomationElement]]::new()
  $printFrame = [IntPtr]::Zero
  if ($inspectPrint) {
    $printFrame = [PioraPrintFrame]::Find($BrowserProcess, $previousFrames, $previousProxies)
    if ($printFrame -ne [IntPtr]::Zero) {
      $frameElement = [System.Windows.Automation.AutomationElement]::FromHandle($printFrame)
      # The native title identifies the requesting application, for example "Piora - 打印".
      $belongs = $appNames | Where-Object { $frameElement.Current.Name.StartsWith($_ + ' - ', [StringComparison]::OrdinalIgnoreCase) }
      if ($belongs) { $windows.Add($frameElement) }
    }
  }
  foreach ($rootWindow in [System.Windows.Automation.AutomationElement]::RootElement.FindAll($scope::Children,$trueCondition)) {
    if (!(OwnedWindow $rootWindow)) {
      if ($Operation -eq 'save-pdf' -and $rootWindow.Current.Name -match 'Save.*Output|保存打印|将打印输出|Print to PDF') {
        # Diagnose newly encountered broker layouts without recording files or
        # sending input to a window whose ownership is not established.
        $nativeOwner = [PioraMenuDialogOwner]::GetWindow([IntPtr]$rootWindow.Current.NativeWindowHandle, 4)
        [int]$ownerPid = 0
        [void][PioraMenuDialogOwner]::GetWindowThreadProcessId($nativeOwner, [ref]$ownerPid)
        $process = Get-Process -Id $rootWindow.Current.ProcessId -ErrorAction SilentlyContinue
        [void]$printOutputWindows.Add(('class={0},process={1},pid={2},ownerPid={3}' -f $rootWindow.Current.ClassName,$process.ProcessName,$rootWindow.Current.ProcessId,$ownerPid))
      }
      if (!$hostedPrint) { continue }
      $systemPrint = $rootWindow.Current.Name -match '^(Print|打印)(?:$|[ ·\-:：])'
      $saveOutput = $Operation -eq 'save-pdf' -and $rootWindow.Current.Name -match 'Save.*Output|保存打印输出|将打印输出'
      if (!$systemPrint -and !$saveOutput) { continue }
      $process = Get-Process -Id $rootWindow.Current.ProcessId -ErrorAction SilentlyContinue
      if (!$process -or $process.ProcessName -notin @('PrintDialog','PrintIsolationHost','ApplicationFrameHost','splwow64','PrintWorkflowUserSvc')) { continue }
    }
    $windows.Add($rootWindow)
    foreach ($nested in $rootWindow.FindAll($scope::Descendants,$windowCondition)) { $windows.Add($nested) }
  }
  foreach ($window in $windows) {
    try {
      $title = $window.Current.Name
      [void]$ownedTitles.Add(($window.Current.ClassName + "/" + $title))
      if ($Operation -eq 'open') { $wanted = $title -match '^(Open|打开|选择文件)' }
      elseif ($Operation -eq 'save-pdf') { $wanted = $title -match 'Save.*(Output|As)|另存为|保存打印输出|将打印输出' }
      else { $wanted = ($printFrame -ne [IntPtr]::Zero -and $window.Current.NativeWindowHandle -eq $printFrame.ToInt64()) -or $title -match '^(Print|打印)(?:$|[ ·\-:：])' }
      if (!$wanted) { continue }
      $all = @($window.FindAll($scope::Descendants,$trueCondition))
      $observed = @($all | Where-Object {$_.Current.ControlType -in @([System.Windows.Automation.ControlType]::Edit,[System.Windows.Automation.ControlType]::ComboBox) -or $_.Current.AutomationId -in @('1','2','1148','1001')} | ForEach-Object {$_.Current.AutomationId + '/' + $_.Current.ControlType.ProgrammaticName + '/enabled=' + $_.Current.IsEnabled})
      $buttons = @($all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.IsEnabled})
      if ($Operation -eq 'cancel-print') {
        $button = $buttons | Where-Object { $_.Current.AutomationId -in @('2','CloseButton') -or $_.Current.Name -match 'Cancel|取消' } | Select-Object -First 1
        if ($button) { ClickButton $button; return }
        if ($window.Current.ClassName -eq '#32770' -and (OwnedWindow $window)) {
          $handle = [IntPtr]$window.Current.NativeWindowHandle
          $cancel = [PioraMenuDialogOwner]::GetDlgItem($handle, 2)
          if ($cancel -ne [IntPtr]::Zero -and [PioraMenuDialogOwner]::IsWindowEnabled($cancel) -and
              [PioraMenuDialogOwner]::PostMessage($handle, 0x0111, [IntPtr]2, $cancel)) { return }
        }
      } elseif ($Operation -eq 'print-pdf') {
        $printer = $all | Where-Object {$_.Current.Name -eq 'Microsoft Print to PDF'} | Select-Object -First 1
        if (!$printer) {
          $combo = $all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox -and ($_.Current.Name -match 'printer|打印机|name|名称' -or $_.Current.AutomationId -in @('1139','printerSelector'))} | Select-Object -First 1
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
        $button = $buttons | Where-Object {$_.Current.AutomationId -in @('1','PrintButton') -or $_.Current.Name -match '^(Print|打印)(\(&?.\))?$'} | Select-Object -First 1
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
        $dialogHandle = [IntPtr]$window.Current.NativeWindowHandle
        $verified = $false
        if ($edit -and $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$value)) {
          if ($value.Current.Value -ne $path) {$value.SetValue($path)}
          $verified = $value.Current.Value -eq $path
        }
        if (!$verified -and $window.Current.ClassName -eq '#32770') {
          $verified = [PioraMenuDialogOwner]::SetFixtureFilename($dialogHandle,$path)
        }
        if (!$verified) {continue}
        $button = $all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and ($_.Current.AutomationId -eq '1' -or $_.Current.Name -match '^(Open|打开|Save|保存)(\(&?.\))?$')} | Select-Object -First 1
        if ($button -and $button.Current.IsEnabled) {ClickButton $button; return}
        # Filtered Win32 choosers sometimes expose the Open split button as a Pane in UIA.
        if ($window.Current.ClassName -eq '#32770') {
          $defaultButton = [PioraMenuDialogOwner]::GetDlgItem($dialogHandle, 1)
          if ($defaultButton -ne [IntPtr]::Zero -and [PioraMenuDialogOwner]::IsWindowEnabled($defaultButton)) {
            if ([PioraMenuDialogOwner]::PostMessage($dialogHandle, 0x0111, [IntPtr]1, $defaultButton)) {return}
          }
        }
      }
    } catch [System.Windows.Automation.ElementNotAvailableException] { continue }
  }
  Start-Sleep -Milliseconds 180
}
$printDiagnostic = if ($inspectPrint) { ". Window metadata: " + [PioraPrintFrame]::Describe($BrowserProcess, $previousProxies) }
    elseif ($Operation -eq 'save-pdf') { ". Print output window metadata: " + ($printOutputWindows -join '; ') } else { '' }
throw ("Fixture-owned dialog unavailable for " + $Operation + ". Owned windows: " + ($ownedTitles -join ', ') + ". Controls: " + ($observed -join ', ') + $printDiagnostic)
