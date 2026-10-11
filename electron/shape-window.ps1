# Glowstone Launcher 窗口圆角辅助（显示优先，绝不因圆角牺牲可见性）。
# Win11：DwmSetWindowAttribute 系统原生圆角（保留阴影，最大化时系统自动直角）。
# Win10：SetWindowRgn 区域圆角。尺寸一律取自 GetClientRect 的物理像素，圆角半径按窗口
#        DPI 缩放，避免高 DPI 下用逻辑像素算错区域把窗口内容裁掉（表现为“打开不显示”）。
#        任何异常或尺寸不合理都回退为完整矩形（SetWindowRgn NULL），保证窗口完整可见。
# 结果以一行 stdout 返回，便于主进程判定是否需要重试：
#   ROUND_RGN / ROUND_DWM / RECT_MAX / RECT_BADSIZE / RECT_NORGN / FAIL <msg>
param(
    [Parameter(Mandatory=$true)][Int64]$Hwnd,
    [int]$RadiusDip = 10,
    [switch]$Maximized
)
$src = @"
using System;
using System.Runtime.InteropServices;
namespace Glowstone {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static class Shape {
    [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int x1, int y1, int x2, int y2, int cx, int cy);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  }
}
"@
if (-not ("Glowstone.Shape" -as [type])) { Add-Type -TypeDefinition $src -Language CSharp }

$h = [IntPtr]$Hwnd

# 兜底：无论后续发生什么，出错都恢复为完整矩形（NULL 区域 = 不裁剪，窗口一定完整可见）
try {
    $build = [System.Environment]::OSVersion.Version.Build
    if ($build -ge 22000) {
        # Windows 11：系统原生圆角（DWMWCP_ROUND = 2）；最大化时清空区域铺满，系统自动直角
        if ($Maximized) {
            [Glowstone.Shape]::SetWindowRgn($h, [IntPtr]::Zero, $true) | Out-Null
            Write-Output "RECT_MAX"
            exit 0
        }
        $pref = 2
        [Glowstone.Shape]::DwmSetWindowAttribute($h, 33, [ref]$pref, 4) | Out-Null
        Write-Output "ROUND_DWM"
        exit 0
    }

    # Windows 10：区域圆角
    if ($Maximized) {
        [Glowstone.Shape]::SetWindowRgn($h, [IntPtr]::Zero, $true) | Out-Null
        Write-Output "RECT_MAX"
        exit 0
    }

    $rc = New-Object Glowstone.RECT
    $ok = [Glowstone.Shape]::GetClientRect($h, [ref]$rc)
    $cw = $rc.Right - $rc.Left
    $ch = $rc.Bottom - $rc.Top

    # 尺寸不合理（拿不到矩形 / 窗口过小 / 句柄无效）：回退完整矩形，保证内容完整可见
    if (-not $ok -or $cw -lt 120 -or $ch -lt 120) {
        [Glowstone.Shape]::SetWindowRgn($h, [IntPtr]::Zero, $true) | Out-Null
        Write-Output "RECT_BADSIZE ${cw}x${ch}"
        exit 0
    }

    # 圆角半径：逻辑像素 -> 当前窗口物理像素
    $dpi = [Glowstone.Shape]::GetDpiForWindow($h)
    if ($dpi -eq 0) { $dpi = 96 }
    $scale = [double]$dpi / 96.0
    $radPhys = [int][Math]::Round($RadiusDip * $scale)
    $d = [Math]::Max(4, $radPhys) * 2
    $shortSide = [Math]::Min($cw, $ch)
    if ($d -ge $shortSide) { $d = [Math]::Max(2, $shortSide - 2) }

    $rgn = [Glowstone.Shape]::CreateRoundRectRgn(0, 0, $cw + 1, $ch + 1, $d, $d)
    if ($rgn -eq [IntPtr]::Zero) {
        [Glowstone.Shape]::SetWindowRgn($h, [IntPtr]::Zero, $true) | Out-Null
        Write-Output "RECT_NORGN"
    } else {
        [Glowstone.Shape]::SetWindowRgn($h, $rgn, $true) | Out-Null
        Write-Output "ROUND_RGN ${cw}x${ch} d=$d dpi=$dpi"
    }
    exit 0
}
catch {
    try { [Glowstone.Shape]::SetWindowRgn($h, [IntPtr]::Zero, $true) | Out-Null } catch {}
    Write-Output ("FAIL " + $_.Exception.Message)
    exit 0
}
