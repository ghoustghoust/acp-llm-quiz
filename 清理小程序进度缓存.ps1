# 清理微信小程序「全真题库」的本地刷题进度缓存
#
# 作用：删掉小程序 wxc007d9e9f0e8f1c4 保存在本机的答题进度（MMKV 存储文件），
#       让「顺序刷题 / 错题本 / 收藏」全部回到初始状态。
#
# 安全性：
#   1. 只删这一个 appid 目录下的进度文件，不碰聊天记录、不碰其它小程序、不碰题库包体。
#   2. 删除前把原文件连同目录结构完整备份到 D:\program\题库\backup\ 下带时间戳的文件夹。
#   3. 微信没退出时脚本直接退出，不动任何文件。
#
# 用法：powershell -ExecutionPolicy Bypass -File "D:\program\题库\清理小程序进度缓存.ps1"

$ErrorActionPreference = 'Stop'

$AppId   = 'wxc007d9e9f0e8f1c4'
$UserDir = Join-Path $env:APPDATA 'Tencent\xwechat\radium\users'
$BackupRoot = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'backup'

# 每一项：@{ File = <文件对象>; Rel = <相对用户目录的路径，用于备份时保留层级> }
$Targets = @()

Write-Host ''
Write-Host '=== 微信小程序「全真题库」进度缓存清理 ===' -ForegroundColor Cyan
Write-Host ''

# ---------- 1. 确认微信已退出 ----------
$running = @(Get-Process -Name 'Weixin','WeChat','WeChatAppEx','WeChatAppExe' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
    Write-Host '[!] 微信还在运行，先完全退出微信再回来执行。' -ForegroundColor Yellow
    Write-Host ''
    $running | Group-Object ProcessName | ForEach-Object {
        Write-Host ("     仍在运行: {0}  x{1}" -f $_.Name, $_.Count)
    }
    Write-Host ''
    Write-Host '    正确做法：右下角托盘里右键微信图标 -> 退出。' -ForegroundColor Yellow
    Write-Host '    只关窗口不算退出，小程序进程会一直占着这个文件。' -ForegroundColor Yellow
    Write-Host ''
    exit 1
}

# ---------- 2. 找目标文件 ----------
function Add-Target {
    param([string]$Path, [string]$UserRoot)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer) { return }
    # 相对用户目录的路径：用于备份时保留原目录结构，避免同名文件互相覆盖
    $rel = $item.FullName.Substring($UserRoot.TrimEnd('\').Length).TrimStart('\')
    $script:Targets += [pscustomobject]@{ File = $item; Rel = $rel }
}

foreach ($u in (Get-ChildItem $UserDir -Directory -ErrorAction SilentlyContinue)) {
    $userRoot = $u.FullName
    $localDir = Join-Path $userRoot "applet\local\$AppId"
    if (-not (Test-Path $localDir)) { continue }

    # 三处 MMKV 存储：答题进度主要写在 usrmmkvstorage0
    foreach ($sub in 'usrmmkvstorage0','usrmmkvstorage1','mmkvadapterstorage') {
        $p = Join-Path $localDir "$sub\$AppId"
        Add-Target -Path $p        -UserRoot $userRoot
        Add-Target -Path "$p.crc"  -UserRoot $userRoot
    }

    # 小程序全局存储（跨题库的杂项状态）
    $g = Join-Path $userRoot 'applet\local\globalmmkvstorage\applet_global_storage'
    Add-Target -Path $g       -UserRoot $userRoot
    Add-Target -Path "$g.crc" -UserRoot $userRoot

    # 小程序运行日志（顺带清掉，占空间且没用）
    Add-Target -Path (Join-Path $localDir 'usr\miniprogramLog\log1') -UserRoot $userRoot
}

if ($Targets.Count -eq 0) {
    Write-Host '[i] 没找到缓存文件。' -ForegroundColor Yellow
    Write-Host '    可能这个小程序在这台电脑上还没打开过，或已经清过了。'
    Write-Host "    查找路径：$UserDir\<用户>\applet\local\$AppId"
    Write-Host ''
    exit 0
}

# ---------- 3. 展示清单 ----------
Write-Host '将处理以下文件：' -ForegroundColor Cyan
Write-Host ''
foreach ($t in $Targets) {
    Write-Host ("  {0,10:N0} 字节  {1}" -f $t.File.Length, $t.File.FullName)
}
$totalKB = [math]::Round((($Targets | ForEach-Object { $_.File.Length } | Measure-Object -Sum).Sum / 1KB), 0)
Write-Host ''
Write-Host ("  合计 {0} 个文件，{1} KB" -f $Targets.Count, $totalKB)
Write-Host ''
Write-Host '  [不动] 题库包体 __APP__.wxapkg、图标、题库内容 —— 这些保留，不用重新下载。'
Write-Host ''

# ---------- 4. 备份（保留原目录结构）----------
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $BackupRoot "progress-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null

Write-Host '正在备份...' -ForegroundColor Cyan
$copied = 0
foreach ($t in $Targets) {
    $dest = Join-Path $backup $t.Rel
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $t.File.FullName -Destination $dest -Force
    $copied++
}
Write-Host ("  已备份 {0} 个文件 -> {1}" -f $copied, $backup) -ForegroundColor Green
Write-Host ''

# ---------- 5. 确认 ----------
$ans = Read-Host '确认删除这些进度缓存？输入 yes 继续，其它任意键取消'
if ($ans -ne 'yes') {
    Write-Host '已取消，什么都没删。' -ForegroundColor Yellow
    Write-Host "备份仍在：$backup"
    exit 0
}

# ---------- 6. 删除 ----------
$failed = @()
foreach ($t in $Targets) {
    try {
        Remove-Item -LiteralPath $t.File.FullName -Force
        Write-Host ("  [已删除] {0}" -f $t.File.Name) -ForegroundColor Green
    } catch {
        $failed += $t
        Write-Host ("  [失败]   {0}  ->  {1}" -f $t.File.Name, $_.Exception.Message) -ForegroundColor Red
    }
}
Write-Host ''

if ($failed.Count -gt 0) {
    Write-Host '[!] 有文件删不掉，通常是微信没退干净。' -ForegroundColor Yellow
    Write-Host '    请彻底退出微信（托盘右键退出）后重新运行本脚本。' -ForegroundColor Yellow
    Write-Host ''
    exit 1
}

Write-Host '完成。' -ForegroundColor Green
Write-Host ''
Write-Host '下一步：打开微信 -> 进入「全真题库」小程序，进度应该已经归零。'
Write-Host ''
Write-Host "想恢复原进度：退出微信后，把下面备份目录里的内容按同样的相对路径拷回去"
Write-Host "  备份目录：$backup"
Write-Host '  例如：'
foreach ($t in $Targets) {
    if ($t.File.Name -eq 'log1') { continue }
    Write-Host ("    {0}\{1}" -f $backup, $t.Rel) -ForegroundColor DarkGray
    Write-Host ("      ->  {0}" -f $t.File.DirectoryName) -ForegroundColor DarkGray
}
Write-Host ''
