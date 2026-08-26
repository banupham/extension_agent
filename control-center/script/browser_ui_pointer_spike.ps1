param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('back', 'forward')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$TitleContains
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if (-not ('AgentBrowserUiPointer.Native' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace AgentBrowserUiPointer {
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
    public const uint INPUT_KEYBOARD = 1;
    public const uint INPUT_HARDWARE = 2;

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
    public struct POINT {
      public int X;
      public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
      public uint type;
      public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
      [FieldOffset(0)] public MOUSEINPUT mi;
      [FieldOffset(0)] public KEYBDINPUT ki;
      [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
      public int dx;
      public int dy;
      public uint mouseData;
      public uint dwFlags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
      public ushort wVk;
      public ushort wScan;
      public uint dwFlags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
      public uint uMsg;
      public ushort wParamL;
      public ushort wParamH;
    }

    private static int Clamp(int value, int min, int max) {
      return Math.Max(min, Math.Min(max, value));
    }

    public static INPUT MouseAbsolute(int screenX, int screenY) {
      int left = GetSystemMetrics(SM_XVIRTUALSCREEN);
      int top = GetSystemMetrics(SM_YVIRTUALSCREEN);
      int width = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
      int height = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
      int nx = (int)Math.Round((screenX - left) * 65535.0 / Math.Max(1, width - 1));
      int ny = (int)Math.Round((screenY - top) * 65535.0 / Math.Max(1, height - 1));
      nx = Clamp(nx, 0, 65535);
      ny = Clamp(ny, 0, 65535);

      INPUT input = new INPUT();
      input.type = INPUT_MOUSE;
      input.U.mi = new MOUSEINPUT {
        dx = nx,
        dy = ny,
        mouseData = 0,
        dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
        time = 0,
        dwExtraInfo = UIntPtr.Zero
      };
      return input;
    }

    public static INPUT MouseButton(bool down) {
      INPUT input = new INPUT();
      input.type = INPUT_MOUSE;
      input.U.mi = new MOUSEINPUT {
        dx = 0,
        dy = 0,
        mouseData = 0,
        dwFlags = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP,
        time = 0,
        dwExtraInfo = UIntPtr.Zero
      };
      return input;
    }

    public static uint SendOne(INPUT input) {
      INPUT[] inputs = new INPUT[] { input };
      return SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    public static POINT CursorPosition() {
      POINT point;
      if (!GetCursorPos(out point)) {
        throw new InvalidOperationException("GetCursorPos failed: " + Marshal.GetLastWin32Error());
      }
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

    public static IntPtr[] FindVisibleBrowserWindowsContaining(string text) {
      List<IntPtr> matches = new List<IntPtr>();
      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        if (!IsWindowVisible(hWnd)) return true;
        string windowClass = WindowClass(hWnd);
        if (String.IsNullOrWhiteSpace(windowClass) ||
            !windowClass.StartsWith("Chrome_WidgetWin_", StringComparison.Ordinal)) {
          return true;
        }
        string title = WindowTitle(hWnd);
        if (!String.IsNullOrWhiteSpace(title) &&
            title.IndexOf(text, StringComparison.OrdinalIgnoreCase) >= 0) {
          matches.Add(hWnd);
        }
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

function Find-BrowserToolbarControl([IntPtr]$Hwnd, [string]$RequestedAction) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($Hwnd)
  if ($null -eq $root) {
    throw 'browser_ui_automation_root_not_found'
  }

  $all = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  $wanted = if ($RequestedAction -eq 'back') {
    @('Back', 'Go back', 'Quay lại', 'Trở lại')
  } else {
    @('Forward', 'Go forward', 'Chuyển tiếp', 'Tiến tới')
  }

  $matches = @()
  $seenNames = New-Object System.Collections.Generic.List[string]
  foreach ($element in $all) {
    try {
      $current = $element.Current
      if ($current.ControlType.Id -ne [System.Windows.Automation.ControlType]::Button.Id) { continue }
      $name = [string]$current.Name
      if (-not [string]::IsNullOrWhiteSpace($name) -and $seenNames.Count -lt 40) {
        $seenNames.Add($name)
      }
      if (-not $current.IsEnabled -or $current.IsOffscreen) { continue }
      $rect = $current.BoundingRectangle
      if ($rect.Width -le 1 -or $rect.Height -le 1) { continue }

      $score = 999
      foreach ($candidate in $wanted) {
        if ($name.Equals($candidate, [System.StringComparison]::OrdinalIgnoreCase)) {
          $score = [Math]::Min($score, 0)
        } elseif ($name.StartsWith("${candidate} ", [System.StringComparison]::OrdinalIgnoreCase) -or
                  $name.StartsWith("${candidate} (", [System.StringComparison]::OrdinalIgnoreCase)) {
          $score = [Math]::Min($score, 1)
        }
      }
      if ($score -lt 999) {
        $matches += [pscustomobject]@{ element = $element; name = $name; score = $score; rect = $rect }
      }
    } catch {
      continue
    }
  }

  if ($matches.Count -eq 0) {
    throw "browser_ui_control_not_found:${RequestedAction}:buttons=$($seenNames -join '|')"
  }

  $bestScore = ($matches | Measure-Object -Property score -Minimum).Minimum
  $best = @($matches | Where-Object { $_.score -eq $bestScore })
  if ($best.Count -ne 1) {
    $descriptions = @($best | ForEach-Object {
      "$($_.name)@$([int]$_.rect.X),$([int]$_.rect.Y),$([int]$_.rect.Width)x$([int]$_.rect.Height)"
    })
    throw "browser_ui_control_ambiguous:${RequestedAction}:$($descriptions -join '|')"
  }
  return $best[0]
}

$matches = [AgentBrowserUiPointer.Native]::FindVisibleBrowserWindowsContaining($TitleContains)
if ($matches.Count -eq 0) {
  throw "browser_ui_window_not_found:$TitleContains"
}
if ($matches.Count -gt 1) {
  $descriptions = @($matches | ForEach-Object {
    $candidateTitle = [AgentBrowserUiPointer.Native]::WindowTitle($_)
    $candidateClass = [AgentBrowserUiPointer.Native]::WindowClass($_)
    "${candidateTitle}@${candidateClass}"
  })
  throw "browser_ui_window_ambiguous:${TitleContains}:$($descriptions -join '|')"
}

$hwnd = $matches[0]
$windowTitle = [AgentBrowserUiPointer.Native]::WindowTitle($hwnd)
$windowClass = [AgentBrowserUiPointer.Native]::WindowClass($hwnd)
$wasMinimized = [AgentBrowserUiPointer.Native]::IsIconic($hwnd)
if ($wasMinimized) {
  [AgentBrowserUiPointer.Native]::ShowWindowAsync($hwnd, [AgentBrowserUiPointer.Native]::SW_RESTORE) | Out-Null
  Start-Sleep -Milliseconds 120
}

[AgentBrowserUiPointer.Native]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 180
if ([AgentBrowserUiPointer.Native]::GetForegroundWindow() -ne $hwnd) {
  throw "browser_ui_foreground_failed:$windowTitle"
}

$inputSize = [Runtime.InteropServices.Marshal]::SizeOf([type][AgentBrowserUiPointer.Native+INPUT])
$expectedInputSize = if ([IntPtr]::Size -eq 8) { 40 } else { 28 }
if ($inputSize -ne $expectedInputSize) {
  throw "browser_ui_input_layout_invalid:size=${inputSize}:expected=${expectedInputSize}:pointerSize=$([IntPtr]::Size)"
}

$control = Find-BrowserToolbarControl -Hwnd $hwnd -RequestedAction $Action
$rect = $control.rect
$targetX = [int][Math]::Round($rect.X + ($rect.Width / 2.0))
$targetY = [int][Math]::Round($rect.Y + ($rect.Height / 2.0))
$start = [AgentBrowserUiPointer.Native]::CursorPosition()
$startX = [int]$start.X
$startY = [int]$start.Y
$dx = [double]($targetX - $startX)
$dy = [double]($targetY - $startY)
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
  $sentMove = [AgentBrowserUiPointer.Native]::SendOne([AgentBrowserUiPointer.Native]::MouseAbsolute($x, $y))
  Assert-SentOne -Sent $sentMove -Stage "move-${i}"
  Start-Sleep -Milliseconds 14
}

Start-Sleep -Milliseconds 45
$sentDown = [AgentBrowserUiPointer.Native]::SendOne([AgentBrowserUiPointer.Native]::MouseButton($true))
Assert-SentOne -Sent $sentDown -Stage 'left-down'
$holdMs = 70
Start-Sleep -Milliseconds $holdMs
$sentUp = [AgentBrowserUiPointer.Native]::SendOne([AgentBrowserUiPointer.Native]::MouseButton($false))
Assert-SentOne -Sent $sentUp -Stage 'left-up'
Start-Sleep -Milliseconds 180
$finish = [AgentBrowserUiPointer.Native]::CursorPosition()

[pscustomobject]@{
  ok = $true
  surface = 'browser-ui-os'
  action = $Action
  mechanism = 'Win32.SendInput.pointer'
  targetDiscovery = 'Windows.UIAutomation'
  controlName = $control.name
  controlBounds = [pscustomobject]@{
    x = [int][Math]::Round($rect.X)
    y = [int][Math]::Round($rect.Y)
    width = [int][Math]::Round($rect.Width)
    height = [int][Math]::Round($rect.Height)
  }
  cursorStart = [pscustomobject]@{ x = $startX; y = $startY }
  cursorTarget = [pscustomobject]@{ x = $targetX; y = $targetY }
  cursorAfter = [pscustomobject]@{ x = [int]$finish.X; y = [int]$finish.Y }
  trajectory = 'smoothstep-curved-multistep'
  trajectorySteps = [int]$steps
  moveIntervalMs = 14
  preDownDwellMs = 45
  holdMs = $holdMs
  mouseDownEventsSent = 1
  mouseUpEventsSent = 1
  windowTitle = $windowTitle
  windowClass = $windowClass
  hwnd = ('0x{0:X}' -f $hwnd.ToInt64())
  windowWasMinimized = [bool]$wasMinimized
  inputStructSize = [int]$inputSize
} | ConvertTo-Json -Compress
