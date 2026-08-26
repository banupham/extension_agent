param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('back', 'forward')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$TitleContains
)

$ErrorActionPreference = 'Stop'

if (-not ('AgentBrowserUi.Native' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace AgentBrowserUi {
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
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    public const int SW_RESTORE = 9;
    public const uint INPUT_MOUSE = 0;
    public const uint INPUT_KEYBOARD = 1;
    public const uint INPUT_HARDWARE = 2;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const ushort VK_MENU = 0x12;
    public const ushort VK_LEFT = 0x25;
    public const ushort VK_RIGHT = 0x27;

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

    public static INPUT Key(ushort virtualKey, bool keyUp) {
      INPUT input = new INPUT();
      input.type = INPUT_KEYBOARD;
      input.U.ki = new KEYBDINPUT {
        wVk = virtualKey,
        wScan = 0,
        dwFlags = keyUp ? KEYEVENTF_KEYUP : 0,
        time = 0,
        dwExtraInfo = UIntPtr.Zero
      };
      return input;
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

$matches = [AgentBrowserUi.Native]::FindVisibleBrowserWindowsContaining($TitleContains)
if ($matches.Count -eq 0) {
  throw "browser_ui_window_not_found:$TitleContains"
}

if ($matches.Count -gt 1) {
  $descriptions = @($matches | ForEach-Object {
    $candidateTitle = [AgentBrowserUi.Native]::WindowTitle($_)
    $candidateClass = [AgentBrowserUi.Native]::WindowClass($_)
    "${candidateTitle}@${candidateClass}"
  })
  throw "browser_ui_window_ambiguous:${TitleContains}:$($descriptions -join '|')"
}

$hwnd = $matches[0]
$windowTitle = [AgentBrowserUi.Native]::WindowTitle($hwnd)
$windowClass = [AgentBrowserUi.Native]::WindowClass($hwnd)
$wasMinimized = [AgentBrowserUi.Native]::IsIconic($hwnd)
if ($wasMinimized) {
  [AgentBrowserUi.Native]::ShowWindowAsync($hwnd, [AgentBrowserUi.Native]::SW_RESTORE) | Out-Null
  Start-Sleep -Milliseconds 120
}

[AgentBrowserUi.Native]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 180

if ([AgentBrowserUi.Native]::GetForegroundWindow() -ne $hwnd) {
  throw "browser_ui_foreground_failed:$windowTitle"
}

$arrowKey = if ($Action -eq 'back') {
  [AgentBrowserUi.Native]::VK_LEFT
} else {
  [AgentBrowserUi.Native]::VK_RIGHT
}

$inputs = @(
  [AgentBrowserUi.Native]::Key([AgentBrowserUi.Native]::VK_MENU, $false),
  [AgentBrowserUi.Native]::Key($arrowKey, $false),
  [AgentBrowserUi.Native]::Key($arrowKey, $true),
  [AgentBrowserUi.Native]::Key([AgentBrowserUi.Native]::VK_MENU, $true)
)

$inputSize = [Runtime.InteropServices.Marshal]::SizeOf([type][AgentBrowserUi.Native+INPUT])
$expectedInputSize = if ([IntPtr]::Size -eq 8) { 40 } else { 28 }
if ($inputSize -ne $expectedInputSize) {
  throw "browser_ui_input_layout_invalid:size=${inputSize}:expected=${expectedInputSize}:pointerSize=$([IntPtr]::Size)"
}

$sent = [AgentBrowserUi.Native]::SendInput(
  [uint32]$inputs.Count,
  $inputs,
  $inputSize
)

if ($sent -ne $inputs.Count) {
  $lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  throw "browser_ui_send_input_failed:sent=${sent}:expected=$($inputs.Count):lastError=$lastError"
}

Start-Sleep -Milliseconds 160

[pscustomobject]@{
  ok = $true
  surface = 'browser-ui-os'
  action = $Action
  windowTitle = $windowTitle
  windowClass = $windowClass
  hwnd = ('0x{0:X}' -f $hwnd.ToInt64())
  windowWasMinimized = [bool]$wasMinimized
  inputStructSize = [int]$inputSize
  inputEventsSent = [int]$sent
  mechanism = 'Win32.SendInput'
} | ConvertTo-Json -Compress
