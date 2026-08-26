param(
  [Parameter(Mandatory = $true)]
  [string]$AnchorTabTitle,

  [Parameter(Mandatory = $true)]
  [string]$TargetTabTitle
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if (-not ('AgentBrowserUiSwitchTab.Native' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace AgentBrowserUiSwitchTab {
  public static class Native {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    public const int SW_RESTORE = 9;
    public const uint INPUT_MOUSE = 0;
    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    public const int SM_XVIRTUALSCREEN = 76;
    public const int SM_YVIRTUALSCREEN = 77;
    public const int SM_CXVIRTUALSCREEN = 78;
    public const int SM_CYVIRTUALSCREEN = 79;

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public InputUnion U; }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
      [FieldOffset(0)] public MOUSEINPUT mi;
      [FieldOffset(0)] public KEYBDINPUT ki;
      [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
      public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
      public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

    private static int Clamp(int value, int min, int max) { return Math.Max(min, Math.Min(max, value)); }

    public static INPUT MouseAbsolute(int screenX, int screenY) {
      int left = GetSystemMetrics(SM_XVIRTUALSCREEN);
      int top = GetSystemMetrics(SM_YVIRTUALSCREEN);
      int width = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
      int height = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
      int nx = (int)Math.Round((screenX - left) * 65535.0 / Math.Max(1, width - 1));
      int ny = (int)Math.Round((screenY - top) * 65535.0 / Math.Max(1, height - 1));
      INPUT input = new INPUT();
      input.type = INPUT_MOUSE;
      input.U.mi = new MOUSEINPUT {
        dx = Clamp(nx, 0, 65535), dy = Clamp(ny, 0, 65535), mouseData = 0,
        dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
        time = 0, dwExtraInfo = UIntPtr.Zero
      };
      return input;
    }

    public static INPUT MouseButton(bool down) {
      INPUT input = new INPUT();
      input.type = INPUT_MOUSE;
      input.U.mi = new MOUSEINPUT {
        dx = 0, dy = 0, mouseData = 0,
        dwFlags = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP,
        time = 0, dwExtraInfo = UIntPtr.Zero
      };
      return input;
    }

    public static uint SendOne(INPUT input) {
      return SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
    }

    public static POINT CursorPosition() {
      POINT point;
      if (!GetCursorPos(out point)) throw new InvalidOperationException("GetCursorPos failed: " + Marshal.GetLastWin32Error());
      return point;
    }

    public static string WindowTitle(IntPtr hWnd) {
      int length = GetWindowTextLength(hWnd);
      if (length <= 0) return String.Empty;
      StringBuilder sb = new StringBuilder(length + 1);
      GetWindowText(hWnd, sb, sb.Capacity);
      return sb.ToString();
    }

    public static string WindowClass(IntPtr hWnd) {
      StringBuilder sb = new StringBuilder(256);
      int length = GetClassName(hWnd, sb, sb.Capacity);
      return length > 0 ? sb.ToString() : String.Empty;
    }

    public static IntPtr[] FindVisibleBrowserWindows() {
      List<IntPtr> matches = new List<IntPtr>();
      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        if (!IsWindowVisible(hWnd)) return true;
        string cls = WindowClass(hWnd);
        if (!String.IsNullOrWhiteSpace(cls) && cls.StartsWith("Chrome_WidgetWin_", StringComparison.Ordinal)) matches.Add(hWnd);
        return true;
      }, IntPtr.Zero);
      return matches.ToArray();
    }
  }
}
'@
}

function Assert-SentOne([uint32]$Sent, [string]$Stage) {
  if ($Sent -ne 1) {
    $lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "browser_ui_send_input_failed:stage=${Stage}:sent=${Sent}:expected=1:lastError=${lastError}"
  }
}

function Get-UiRoot([IntPtr]$Hwnd) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($Hwnd)
  if ($null -eq $root) { throw 'browser_ui_automation_root_not_found' }
  return $root
}

function Get-ElementRect($Element) {
  $rect = $Element.Current.BoundingRectangle
  if ($rect.Width -le 1 -or $rect.Height -le 1) { return $null }
  return $rect
}

function Get-TabItems($Root) {
  $all = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $items = @()
  foreach ($element in $all) {
    try {
      $current = $element.Current
      if ($current.ControlType.Id -ne [System.Windows.Automation.ControlType]::TabItem.Id) { continue }
      if (-not $current.IsEnabled -or $current.IsOffscreen) { continue }
      $rect = Get-ElementRect $element
      if ($null -eq $rect) { continue }
      $items += [pscustomobject]@{ element = $element; name = [string]$current.Name; rect = $rect }
    } catch { continue }
  }
  return @($items)
}

function Find-TabMatches($Root, [string]$WantedTitle) {
  $wanted = $WantedTitle.Trim()
  $matches = @()
  foreach ($item in (Get-TabItems $Root)) {
    $name = [string]$item.name
    $score = 999
    if ($name.Equals($wanted, [System.StringComparison]::OrdinalIgnoreCase)) { $score = 0 }
    elseif ($name.StartsWith($wanted, [System.StringComparison]::OrdinalIgnoreCase)) { $score = 1 }
    if ($score -lt 999) {
      $matches += [pscustomobject]@{ element = $item.element; name = $name; rect = $item.rect; score = $score }
    }
  }
  return @($matches)
}

function Select-UniqueTab($Matches, [string]$WantedTitle) {
  if ($Matches.Count -eq 0) { return $null }
  $bestScore = ($Matches | Measure-Object -Property score -Minimum).Minimum
  $best = @($Matches | Where-Object { $_.score -eq $bestScore })
  if ($best.Count -ne 1) { throw "browser_ui_tab_ambiguous:${WantedTitle}" }
  return $best[0]
}

function Resolve-BrowserWindowByTabAnchor([string]$AnchorTitle, [string]$TargetTitle) {
  $windows = [AgentBrowserUiSwitchTab.Native]::FindVisibleBrowserWindows()
  $matches = @()
  $diagnostics = @()
  foreach ($candidate in $windows) {
    try {
      $root = Get-UiRoot $candidate
      $names = @((Get-TabItems $root) | ForEach-Object { $_.name })
      $diagnostics += "$([AgentBrowserUiSwitchTab.Native]::WindowTitle($candidate))=>[$($names -join '|')]"
      $anchor = Select-UniqueTab -Matches (Find-TabMatches -Root $root -WantedTitle $AnchorTitle) -WantedTitle $AnchorTitle
      if ($null -eq $anchor) { continue }
      $target = Select-UniqueTab -Matches (Find-TabMatches -Root $root -WantedTitle $TargetTitle) -WantedTitle $TargetTitle
      if ($null -eq $target) { continue }
      $matches += [pscustomobject]@{ hwnd = $candidate; windowTitle = [AgentBrowserUiSwitchTab.Native]::WindowTitle($candidate) }
    } catch { continue }
  }
  if ($matches.Count -eq 0) {
    throw "browser_ui_window_not_found_by_tab_anchor:anchor=${AnchorTitle}:target=${TargetTitle}:windows=$($diagnostics -join ' || ')"
  }
  if ($matches.Count -gt 1) {
    $desc = @($matches | ForEach-Object { "$($_.windowTitle)@$($_.hwnd)" })
    throw "browser_ui_window_ambiguous_by_tab_anchor:anchor=${AnchorTitle}:$($desc -join '|')"
  }
  return $matches[0]
}

function Move-PhysicalPointer([int]$TargetX, [int]$TargetY) {
  $start = [AgentBrowserUiSwitchTab.Native]::CursorPosition()
  $startX = [int]$start.X
  $startY = [int]$start.Y
  $dx = [double]($TargetX - $startX)
  $dy = [double]($TargetY - $startY)
  $distance = [Math]::Sqrt(($dx * $dx) + ($dy * $dy))
  $steps = [Math]::Max(12, [Math]::Min(32, [int][Math]::Ceiling($distance / 35.0)))
  $curveAmplitude = [Math]::Min(24.0, [Math]::Max(4.0, $distance * 0.04))
  $perpX = if ($distance -gt 0.001) { -$dy / $distance } else { 0.0 }
  $perpY = if ($distance -gt 0.001) { $dx / $distance } else { 0.0 }

  for ($i = 1; $i -le $steps; $i += 1) {
    $t = [double]$i / [double]$steps
    $ease = ($t * $t) * (3.0 - (2.0 * $t))
    $curve = [Math]::Sin([Math]::PI * $t) * $curveAmplitude
    $x = [int][Math]::Round($startX + ($dx * $ease) + ($perpX * $curve))
    $y = [int][Math]::Round($startY + ($dy * $ease) + ($perpY * $curve))
    Assert-SentOne -Sent ([AgentBrowserUiSwitchTab.Native]::SendOne([AgentBrowserUiSwitchTab.Native]::MouseAbsolute($x, $y))) -Stage "move-${i}"
    Start-Sleep -Milliseconds 14
  }
  return [pscustomobject]@{ startX = $startX; startY = $startY; targetX = $TargetX; targetY = $TargetY; steps = [int]$steps }
}

function Click-Tab($TabInfo) {
  $rect = $TabInfo.rect
  $x = [int][Math]::Round($rect.X + ($rect.Width / 2.0))
  $y = [int][Math]::Round($rect.Y + ($rect.Height / 2.0))
  $move = Move-PhysicalPointer -TargetX $x -TargetY $y
  Start-Sleep -Milliseconds 45
  Assert-SentOne -Sent ([AgentBrowserUiSwitchTab.Native]::SendOne([AgentBrowserUiSwitchTab.Native]::MouseButton($true))) -Stage 'left-down'
  $holdMs = 70
  Start-Sleep -Milliseconds $holdMs
  Assert-SentOne -Sent ([AgentBrowserUiSwitchTab.Native]::SendOne([AgentBrowserUiSwitchTab.Native]::MouseButton($false))) -Stage 'left-up'
  return [pscustomobject]@{
    cursorStart = [pscustomobject]@{ x = $move.startX; y = $move.startY }
    cursorTarget = [pscustomobject]@{ x = $move.targetX; y = $move.targetY }
    trajectorySteps = $move.steps
    preDownDwellMs = 45
    holdMs = $holdMs
  }
}

function Get-IsSelected($TabElement) {
  try {
    $pattern = $TabElement.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    return [bool]$pattern.Current.IsSelected
  } catch { return $false }
}

if ([string]::IsNullOrWhiteSpace($AnchorTabTitle)) { throw 'browser_ui_switch_tab_anchor_required' }
if ([string]::IsNullOrWhiteSpace($TargetTabTitle)) { throw 'browser_ui_switch_tab_target_required' }

$resolved = Resolve-BrowserWindowByTabAnchor -AnchorTitle $AnchorTabTitle -TargetTitle $TargetTabTitle
$hwnd = [IntPtr]$resolved.hwnd
$windowTitleBefore = [AgentBrowserUiSwitchTab.Native]::WindowTitle($hwnd)
$windowClass = [AgentBrowserUiSwitchTab.Native]::WindowClass($hwnd)
$lease = New-Object System.Threading.Mutex($false, 'Local\AgentBrowserUiOsInputLease')
$leaseAcquired = $false

try {
  try { $leaseAcquired = $lease.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $leaseAcquired = $true }
  if (-not $leaseAcquired) { throw 'browser_ui_os_input_lease_busy' }

  if ([AgentBrowserUiSwitchTab.Native]::IsIconic($hwnd)) {
    [AgentBrowserUiSwitchTab.Native]::ShowWindowAsync($hwnd, [AgentBrowserUiSwitchTab.Native]::SW_RESTORE) | Out-Null
    Start-Sleep -Milliseconds 120
  }
  [AgentBrowserUiSwitchTab.Native]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 180
  if ([AgentBrowserUiSwitchTab.Native]::GetForegroundWindow() -ne $hwnd) { throw "browser_ui_foreground_failed:$windowTitleBefore" }

  $inputSize = [Runtime.InteropServices.Marshal]::SizeOf([type][AgentBrowserUiSwitchTab.Native+INPUT])
  $expectedInputSize = if ([IntPtr]::Size -eq 8) { 40 } else { 28 }
  if ($inputSize -ne $expectedInputSize) { throw "browser_ui_input_layout_invalid:size=${inputSize}:expected=${expectedInputSize}" }

  $root = Get-UiRoot $hwnd
  $targetTab = Select-UniqueTab -Matches (Find-TabMatches -Root $root -WantedTitle $TargetTabTitle) -WantedTitle $TargetTabTitle
  if ($null -eq $targetTab) { throw "browser_ui_tab_not_found:$TargetTabTitle" }
  $clickEvidence = Click-Tab $targetTab
  Start-Sleep -Milliseconds 320

  $rootAfter = Get-UiRoot $hwnd
  $targetAfter = Select-UniqueTab -Matches (Find-TabMatches -Root $rootAfter -WantedTitle $TargetTabTitle) -WantedTitle $TargetTabTitle
  if ($null -eq $targetAfter) { throw "browser_ui_switch_tab_target_missing_after:$TargetTabTitle" }
  $selectedAfter = Get-IsSelected $targetAfter.element
  $windowTitleAfter = [AgentBrowserUiSwitchTab.Native]::WindowTitle($hwnd)
  $titleMatched = $windowTitleAfter.IndexOf($TargetTabTitle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  if (-not $selectedAfter -and -not $titleMatched) { throw "browser_ui_switch_tab_not_observed:$TargetTabTitle" }

  $finish = [AgentBrowserUiSwitchTab.Native]::CursorPosition()
  [pscustomobject]@{
    ok = $true
    surface = 'browser-ui-os'
    action = 'switchTab'
    mechanism = 'Win32.SendInput.pointer'
    targetDiscovery = 'Windows.UIAutomation'
    windowResolution = 'Windows.UIAutomation.tab-anchor'
    anchorTabTitle = $AnchorTabTitle
    targetTabTitle = $TargetTabTitle
    targetControlName = $targetTab.name
    trajectory = 'smoothstep-curved-multistep'
    trajectorySteps = $clickEvidence.trajectorySteps
    moveIntervalMs = 14
    preDownDwellMs = $clickEvidence.preDownDwellMs
    holdMs = $clickEvidence.holdMs
    mouseDownEventsSent = 1
    mouseUpEventsSent = 1
    cursorStart = $clickEvidence.cursorStart
    cursorTarget = $clickEvidence.cursorTarget
    cursorAfter = [pscustomobject]@{ x = [int]$finish.X; y = [int]$finish.Y }
    windowTitleBefore = $windowTitleBefore
    windowTitleAfter = $windowTitleAfter
    windowClass = $windowClass
    hwnd = ('0x{0:X}' -f $hwnd.ToInt64())
    lease = [pscustomobject]@{ name = 'Local\AgentBrowserUiOsInputLease'; exclusive = $true; acquired = $true; inputChannels = @('pointer') }
    verification = [pscustomobject]@{ selectedAfter = $selectedAfter; windowTitleMatched = $titleMatched }
  } | ConvertTo-Json -Depth 6
}
finally {
  if ($leaseAcquired) { try { $lease.ReleaseMutex() } catch {} }
  $lease.Dispose()
}
