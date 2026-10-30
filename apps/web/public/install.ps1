#!/usr/bin/env pwsh
# Installs KnightCode on Windows. Run it again to reinstall or uninstall.

$ErrorActionPreference = "Stop"

$KnightcodePackage = "@knightcodeai/cli"
$KnightcodeCmd = "knightcode"
$KnightcodeInstallerApiBase = if ($env:KNIGHTCODE_INSTALLER_API_BASE) { $env:KNIGHTCODE_INSTALLER_API_BASE } else { "https://knightcode.dev/api/installer/releases" }
$KnightcodeManagedInstallMarker = "managed-install.json"
# Overrides a user npmrc min-release-age so a release can install immediately.
# npm ignores the flag until the version that implements it.
$NpmMinReleaseAgeArg = "--min-release-age=0"
$NodeMinimum = [version]"22.19.0"
$GitForWindowsLatestReleaseApi = "https://api.github.com/repos/git-for-windows/git/releases/latest"
$KnightcodeEsc = [char]27
$KnightcodeCr = [char]13

function Write-InstallerTitle {
  if (Test-InstallerAnsiOutput) {
    [Console]::Write("${KnightcodeEsc}[1m  KnightCode installer${KnightcodeEsc}[0m`n`n")
  } else {
    Write-Host ""
    Write-Host "  KnightCode installer"
    Write-Host ""
  }
}

function Test-InstallerInteractiveOutput {
  return (-not [Console]::IsOutputRedirected) -and ($env:TERM -ne "dumb")
}

function Enable-VirtualTerminalOutput {
  if (-not (Test-InstallerInteractiveOutput)) {
    return $false
  }

  if ($null -ne $script:KnightcodeVirtualTerminalEnabled) {
    return $script:KnightcodeVirtualTerminalEnabled
  }

  if (-not ("ConsoleMode.NativeMethods" -as [Type])) {
    Add-Type -Namespace ConsoleMode -Name NativeMethods -MemberDefinition @"
[DllImport("kernel32.dll", SetLastError = true)]
public static extern System.IntPtr GetStdHandle(int nStdHandle);

[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetConsoleMode(System.IntPtr hConsoleHandle, out uint lpMode);

[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetConsoleMode(System.IntPtr hConsoleHandle, uint dwMode);
"@
  }

  $stdOutputHandle = -11
  $enableVirtualTerminalProcessing = 0x0004
  $handle = [ConsoleMode.NativeMethods]::GetStdHandle($stdOutputHandle)
  $mode = [uint32]0
  $script:KnightcodeVirtualTerminalEnabled = [ConsoleMode.NativeMethods]::GetConsoleMode($handle, [ref]$mode) -and [ConsoleMode.NativeMethods]::SetConsoleMode($handle, ($mode -bor $enableVirtualTerminalProcessing))
  return $script:KnightcodeVirtualTerminalEnabled
}

function Test-InstallerAnsiOutput {
  return Enable-VirtualTerminalOutput
}

function Test-InstallerInteractiveInput {
  return -not [Console]::IsInputRedirected
}

function Test-TerminalSupportsUnicode {
  $locale = "$env:LC_ALL$env:LC_CTYPE$env:LANG"
  if ($locale -match "(?i)utf-?8") {
    return $true
  }

  if ($env:TERM_PROGRAM -in @("Apple_Terminal", "iTerm.app", "vscode", "WezTerm")) {
    return $true
  }

  if ($env:WT_SESSION -or $env:TERMINAL_EMULATOR) {
    return $true
  }

  return $false
}

function Get-SpinnerFrame {
  param([int]$Step)

  switch ($Step % 4) {
    0 { return "-" }
    1 { return "\" }
    2 { return "|" }
    default { return "/" }
  }
}

function Get-InstallLogLines {
  param([string]$LogFile)

  if (Test-Path $LogFile) {
    return Get-Content $LogFile
  }
  return @()
}

function Get-NpmInstallProgressLabel {
  param([string]$LogFile, [string]$CurrentLabel)

  $label = $CurrentLabel
  $metadataCacheCount = 0
  $metadataFetchCount = 0
  $tarballCacheCount = 0
  $tarballFetchCount = 0

  foreach ($line in (Get-InstallLogLines $LogFile)) {
    $line = ($line -split $KnightcodeCr)[-1]
    if ($line -like "Downloading managed installer release metadata*") {
      $label = "resolving managed release"
    } elseif ($line -like "Downloading managed installer package.json*") {
      $label = "fetching managed package manifest"
    } elseif ($line -like "Downloading managed installer package-lock.json*") {
      $label = "fetching managed package lock"
    } elseif ($line -like "Installing managed KnightCode dependencies*") {
      $label = "installing managed dependencies"
    } elseif ($line -like "Verifying managed KnightCode*") {
      $label = "verifying managed package"
    } elseif ($line -like "Activating managed KnightCode*") {
      $label = "activating managed package"
    } elseif ($line -like "Removing npm-installed KnightCode*") {
      $label = "removing npm-installed package"
    } elseif ($line -like "Managed KnightCode install complete*") {
      $label = "managed install complete"
    } elseif (($line -like "npm verbose title npm install*") -or ($line -like "npm verbose title npm ci*")) {
      $label = "resolving packages"
    } elseif ($line -match "npm http fetch GET .*https://registry\.npmjs\.org/.*\.tgz") {
      $tarballFetchCount += 1
      $label = "fetching tarballs ($tarballFetchCount)"
    } elseif ($line -match "npm http cache .*@https://registry\.npmjs\.org/.*\.tgz") {
      $tarballCacheCount += 1
      if ($tarballFetchCount -gt 0) {
        $label = "fetching tarballs ($tarballFetchCount)"
      } else {
        $label = "checking tarballs ($tarballCacheCount)"
      }
    } elseif ($line -match "npm http fetch GET .*https://registry\.npmjs\.org/") {
      $metadataFetchCount += 1
      $label = "fetching package metadata ($metadataFetchCount)"
    } elseif ($line -match "npm http cache https://registry\.npmjs\.org/") {
      $metadataCacheCount += 1
      if ($metadataFetchCount -gt 0) {
        $label = "fetching package metadata ($metadataFetchCount)"
      } else {
        $label = "checking cached metadata ($metadataCacheCount)"
      }
    } elseif ($line -like "npm info run *") {
      $rest = $line.Substring("npm info run ".Length)
      $parts = $rest -split " "
      $package = $parts[0]
      $script = if ($parts.Length -gt 1) { $parts[1] } else { "script" }
      $package = $package -replace "@[^@]*$", ""
      if ($line -like "*{ code:*") {
        $label = "finished $script for $package"
      } else {
        $label = "running $script for $package"
      }
    } elseif (($line -like "changed *") -or ($line -like "added *") -or ($line -like "removed *") -or ($line -like "updated *") -or ($line -like "up to date *")) {
      $label = $line
    }
  }

  if ($label.Length -gt 64) {
    $label = $label.Substring(0, 61) + "..."
  }
  return $label
}

function Get-VisibleTextLength {
  param([string]$Text)

  $escapedEsc = [regex]::Escape([string]$KnightcodeEsc)
  $visibleText = [regex]::Replace($Text, "${escapedEsc}\[[0-9;?]*[ -/]*[@-~]", "")
  return $visibleText.Length
}

function Write-InstallProgress {
  param([int]$Step, [string]$Frame, [string]$Label, [string]$Title)

  $reset = "${KnightcodeEsc}[0m"
  $dim = "${KnightcodeEsc}[2m"
  $coral = "${KnightcodeEsc}[38;2;240;144;130m"
  $blue = "${KnightcodeEsc}[38;2;77;154;191m"
  $gold = "${KnightcodeEsc}[38;2;241;190;88m"
  $turquoise = "${KnightcodeEsc}[38;2;131;204;210m"
  $bold = "${KnightcodeEsc}[1m"
  $width = 28
  $trail = 8
  $head = $Step % ($width + $trail)
  $bar = ""

  for ($i = 0; $i -lt $width; $i += 1) {
    $age = $head - $i
    if (($age -ge 0) -and ($age -lt $trail)) {
      switch ($age) {
        { $_ -in 0, 1 } { $cell = "${gold}#${reset}"; break }
        { $_ -in 2, 3 } { $cell = "${coral}#${reset}"; break }
        { $_ -in 4, 5 } { $cell = "${blue}#${reset}"; break }
        default { $cell = "${turquoise}#${reset}" }
      }
    } else {
      $cell = "${dim}-${reset}"
    }
    $bar += $cell
  }

  $line = "  ${turquoise}${Frame}${reset} $bar ${bold}${Title}${reset} $Label"
  $visibleWidth = Get-VisibleTextLength $line
  $lastWidth = [int]$script:KnightcodeLastProgressWidth
  $padWidth = [Math]::Max(0, $lastWidth - $visibleWidth)

  [Console]::Write("`r$line" + (" " * $padWidth))
  $script:KnightcodeLastProgressWidth = [Math]::Max($lastWidth, $visibleWidth)
}

function Finish-InstallProgress {
  $lastWidth = [int]$script:KnightcodeLastProgressWidth
  if ($lastWidth -gt 0) {
    [Console]::Write("`r" + (" " * $lastWidth) + "`r")
  } else {
    [Console]::Write("`r")
  }
  [Console]::Write("${KnightcodeEsc}[?25h")
  $script:KnightcodeLastProgressWidth = 0
}

function Write-OutputLines {
  param([object[]]$Lines)

  foreach ($line in $Lines) {
    Write-Host $line
  }
}

function Test-NodeVersionIsNewEnough {
  param([string]$Version)

  $normalized = $Version.TrimStart("v")
  $parsed = [version]$normalized
  return $parsed -ge $NodeMinimum
}

function Invoke-PreflightChecks {
  $status = 0

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $nodeVersion = (& node --version).Trim()
    if (-not (Test-NodeVersionIsNewEnough $nodeVersion)) {
      Write-Output "error: KnightCode requires Node.js 22.19.0 or newer. Found $nodeVersion."
      $status = 1
    }
  } else {
    Write-Output "error: Node.js 22.19.0 or newer is required to install KnightCode."
    $status = 1
  }

  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Write-Output "error: npm is required to install KnightCode."
    $status = 1
  }

  if ($status -ne 0) {
    Write-Output ""
  }

  $script:KnightcodePreflightStatus = $status
}

# Read user environment values directly from the registry instead of using
# [Environment]::GetEnvironmentVariable. The DoNotExpandEnvironmentNames flag keeps
# entries such as %USERPROFILE% literal so writing PATH back does not accidentally
# expand or rewrite user-managed variables.
function Get-UserEnv {
  param([string]$Key)

  $registerKey = Get-Item -Path "HKCU:"
  $envRegisterKey = $registerKey.OpenSubKey("Environment")
  $envRegisterKey.GetValue($Key, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}

# Tell Explorer and newly launched terminals that HKCU:\Environment changed.
# Without this broadcast, PATH updates generally require signing out or restarting
# Windows before other processes notice them.
function Publish-EnvChange {
  if (-not ("Win32.NativeMethods" -as [Type])) {
    Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
    uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
"@
  }

  $hwndBroadcast = [IntPtr]0xffff
  $wmSettingChange = 0x1a
  $result = [UIntPtr]::Zero
  [Win32.NativeMethods]::SendMessageTimeout($hwndBroadcast, $wmSettingChange, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$result) | Out-Null
}

# Preserve ExpandString values when an existing variable uses percent expansion.
# This mirrors how Windows stores PATH and avoids flattening values like %APPDATA%.
function Set-UserEnv {
  param([string]$Key, [string]$Value)

  $registerKey = Get-Item -Path "HKCU:"
  $envRegisterKey = $registerKey.OpenSubKey("Environment", $true)
  if ($null -eq $Value) {
    $envRegisterKey.DeleteValue($Key)
  } else {
    $registryValueKind = if ($Value.Contains("%")) {
      [Microsoft.Win32.RegistryValueKind]::ExpandString
    } elseif ($envRegisterKey.GetValue($Key)) {
      $envRegisterKey.GetValueKind($Key)
    } else {
      [Microsoft.Win32.RegistryValueKind]::String
    }
    $envRegisterKey.SetValue($Key, $Value, $registryValueKind)
  }

  Publish-EnvChange
}

function Add-UserPathEntry {
  param([string]$Directory, [switch]$Prepend)

  # Update both the persisted user PATH and this PowerShell process. The process
  # update lets the remainder of this installer immediately find newly installed
  # node/npm/knightcode shims without asking the user to restart first.
  $path = (Get-UserEnv -Key "Path") -split ";" | Where-Object { $_ -and ($_ -ne $Directory) }
  if ($Prepend) {
    $path = @($Directory) + $path
  } else {
    $path += $Directory
  }
  Set-UserEnv -Key "Path" -Value ($path -join ";")

  $processPath = $env:PATH -split ";" | Where-Object { $_ -and ($_ -ne $Directory) }
  if ($Prepend) {
    $env:PATH = ((@($Directory) + $processPath) -join ";")
  } else {
    $env:PATH = (($processPath + $Directory) -join ";")
  }

  Add-PathRefreshEntry $Directory
}

function Add-PathRefreshEntry {
  param([string]$Directory)

  if (-not $script:KnightcodePathRefreshEntries) {
    $script:KnightcodePathRefreshEntries = @()
  }
  if ($script:KnightcodePathRefreshEntries -notcontains $Directory) {
    $script:KnightcodePathRefreshEntries += $Directory
  }
}

function Get-InstallerParentShell {
  $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
  $parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($currentProcess.ParentProcessId)"
  if ($parentProcess.Name -ieq "cmd.exe") {
    return "cmd"
  }
  return "powershell"
}

function Get-PathRefreshCommand {
  param([string[]]$Directories)

  $prefix = ($Directories | Where-Object { $_ } | Select-Object -Unique) -join ";"
  if (-not $prefix) {
    return ""
  }

  if ((Get-InstallerParentShell) -eq "cmd") {
    return "set `"PATH=$prefix;%PATH%`""
  }
  return "`$env:PATH = `"$prefix;`$env:PATH`""
}

function Write-PathRefreshNote {
  if (-not $script:KnightcodePathRefreshEntries -or $script:KnightcodePathRefreshEntries.Count -eq 0) {
    return
  }

  $command = Get-PathRefreshCommand $script:KnightcodePathRefreshEntries
  if (-not $command) {
    return
  }

  Write-Host ""
  Write-Host "If knightcode is not found in the terminal that launched this installer,"
  Write-Host "restart it or update PATH there now:"
  Write-Host ""
  Write-Host "  $command"
}

function Get-WindowsArch {
  # Use the machine environment registry value rather than process environment
  # variables so ARM64 Windows running an x64 PowerShell still resolves to arm64.
  $arch = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment").PROCESSOR_ARCHITECTURE
  if ($arch -eq "AMD64") {
    return "x64"
  }
  if ($arch -eq "ARM64") {
    return "arm64"
  }

  Write-Host "Unsupported CPU architecture for automatic dependency install: $arch"
  exit 1
}

function Invoke-DownloadFile {
  param([string]$Url, [string]$OutFile)

  # Use curl.exe explicitly: plain "curl" is an alias for Invoke-WebRequest in
  # Windows PowerShell, and curl.exe is substantially faster on older systems.
  curl.exe "-#SfLo" $OutFile $Url
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "curl.exe failed; trying Invoke-RestMethod..."
    Invoke-RestMethod -Uri $Url -OutFile $OutFile
  }
}

function Assert-NodeDownloadChecksum {
  param([string]$ShasumsPath, [string]$NodeFile, [string]$ZipPath)

  $escapedNodeFile = [regex]::Escape($NodeFile)
  $selected = Get-Content $ShasumsPath | Where-Object { $_ -match "^([a-fA-F0-9]+)\s+$escapedNodeFile$" } | Select-Object -First 1
  if (-not $selected) {
    Write-Host "No checksum was found for $NodeFile."
    exit 1
  }

  $expectedHash = ([regex]::Match($selected, "^([a-fA-F0-9]+)")).Groups[1].Value.ToLowerInvariant()
  $actualHash = (Get-FileHash $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    Write-Host "Node.js download checksum verification failed."
    Write-Host "Expected: $expectedHash"
    Write-Host "Actual:   $actualHash"
    exit 1
  }
}

function Install-NodeStandalone {
  $nodeArch = Get-WindowsArch
  $nodeDistBase = "https://nodejs.org/dist/latest-v22.x"
  # Keep the auto-installed Node.js separate from the user's normal Node setup.
  # npm itself still installs KnightCode globally according to npm's configured prefix.
  $nodeBaseDir = Join-Path $env:LOCALAPPDATA "knightcode-node"
  $nodeTmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "knightcode-node-$PID"

  Remove-Item $nodeTmpDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $nodeTmpDir, $nodeBaseDir | Out-Null

  $shasumsPath = Join-Path $nodeTmpDir "SHASUMS256.txt"
  Write-Host "Resolving Node.js binary for win-$nodeArch"
  Invoke-DownloadFile "$nodeDistBase/SHASUMS256.txt" $shasumsPath

  $nodeFile = Get-Content $shasumsPath | ForEach-Object {
    if ($_ -match "\s+(node-v.+-win-$nodeArch\.zip)$") { $Matches[1] }
  } | Select-Object -First 1

  if (-not $nodeFile) {
    Write-Host "No Node.js binary is available for win-$nodeArch."
    exit 1
  }

  $zipPath = Join-Path $nodeTmpDir $nodeFile
  Write-Host "Downloading Node.js $($nodeFile -replace '\.zip$', '')"
  Invoke-DownloadFile "$nodeDistBase/$nodeFile" $zipPath
  Write-Host "Verifying Node.js download"
  Assert-NodeDownloadChecksum $shasumsPath $nodeFile $zipPath

  Write-Host "Extracting Node.js to $nodeBaseDir"
  Expand-Archive $zipPath $nodeTmpDir -Force

  $extractedDir = Join-Path $nodeTmpDir ($nodeFile -replace "\.zip$", "")
  $currentDir = Join-Path $nodeBaseDir "current"
  Remove-Item $currentDir -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item $extractedDir $currentDir -Force
  Remove-Item $nodeTmpDir -Recurse -Force

  Add-UserPathEntry $currentDir -Prepend
  Write-Host "Node.js installed at $currentDir"
}

function Read-NodeNpmInstallChoice {
  if (-not (Test-InstallerInteractiveInput)) {
    Write-Host "No terminal detected; install Node.js 22.19.0 or newer and npm, then run this installer again."
    return $false
  }

  $answer = Read-Host "KnightCode needs Node.js 22.19.0 or newer and npm. Install standalone Node.js now? [Y/n]"
  if ($answer -match "^(n|no)$") {
    Write-Host ""
    Write-Host "Will skip Node.js install."
    return $false
  }

  return $true
}

function Get-KnightcodeAgentDir {
  return Join-Path ([Environment]::GetFolderPath("UserProfile")) ".knightcode\agent"
}

function Test-KnightcodeManagedInstallEnabled {
  return $env:KNIGHTCODE_LEGACY_INSTALL -ne "1"
}

function Get-KnightcodeManagedDefaultAgentDir {
  if ($env:KNIGHTCODE_CODING_AGENT_DIR) {
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($env:KNIGHTCODE_CODING_AGENT_DIR)
  }
  return Get-KnightcodeAgentDir
}

function Get-KnightcodeSettingsPath {
  return Join-Path (Get-KnightcodeAgentDir) "settings.json"
}

function Get-KnightcodeManagedGitBashDir {
  return Join-Path (Get-KnightcodeAgentDir) "win-git-bash"
}

function Get-KnightcodeManagedGitBashPath {
  return Join-Path (Join-Path (Get-KnightcodeManagedGitBashDir) "bin") "bash.exe"
}

function Get-KnightcodeSettingsShellPath {
  $settingsPath = Get-KnightcodeSettingsPath
  if (-not (Test-Path $settingsPath -PathType Leaf)) {
    return ""
  }

  $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
  if ($settings -and ($settings.PSObject.Properties.Name -contains "shellPath")) {
    return [string]$settings.shellPath
  }
  return ""
}

function Set-KnightcodeSettingsShellPath {
  param([string]$ShellPath)

  $settingsPath = Get-KnightcodeSettingsPath
  New-Item -ItemType Directory -Force -Path (Split-Path $settingsPath -Parent) | Out-Null

  if (Test-Path $settingsPath -PathType Leaf) {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
  } else {
    $settings = [PSCustomObject]@{}
  }
  if ($null -eq $settings) {
    $settings = [PSCustomObject]@{}
  }

  $settings | Add-Member -MemberType NoteProperty -Name "shellPath" -Value $ShellPath -Force
  $json = $settings | ConvertTo-Json -Depth 100
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($settingsPath, "$json`r`n", $utf8NoBom)
}

function Find-BashOnPath {
  $command = Get-Command bash.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command -and $command.Source -and (Test-Path $command.Source -PathType Leaf)) {
    return $command.Source
  }
  return ""
}

function Find-GitBashInKnownLocations {
  $paths = @()
  if ($env:ProgramFiles) {
    $paths += Join-Path (Join-Path $env:ProgramFiles "Git") "bin\bash.exe"
  }
  $programFilesX86 = ${env:ProgramFiles(x86)}
  if ($programFilesX86) {
    $paths += Join-Path (Join-Path $programFilesX86 "Git") "bin\bash.exe"
  }

  foreach ($path in $paths) {
    if (Test-Path $path -PathType Leaf) {
      return $path
    }
  }

  return Find-BashOnPath
}

function Find-ExistingBashForKnightcode {
  $configuredShellPath = Get-KnightcodeSettingsShellPath
  if ($configuredShellPath) {
    if (Test-Path $configuredShellPath -PathType Leaf) {
      return $configuredShellPath
    }
    return ""
  }

  return Find-GitBashInKnownLocations
}

function Test-WingetAvailable {
  return [bool](Get-Command winget.exe -ErrorAction SilentlyContinue)
}

function Read-GitBashInstallChoice {
  if (-not (Test-InstallerInteractiveInput)) {
    Write-Host "No terminal detected; skipping optional Git Bash install. Install Git for Windows or set shellPath in settings.json for KnightCode bash commands."
    return "none"
  }

  $gitDir = Get-KnightcodeManagedGitBashDir
  $wingetAvailable = Test-WingetAvailable

  Write-Host "KnightCode needs Git Bash for bash commands."
  Write-Host ""
  Write-Host "Choose Git Bash install method:"
  Write-Host ""
  Write-Host "  y     Install managed Portable Git under $gitDir (default)"
  if ($wingetAvailable) {
    Write-Host "  w     Install Git for Windows globally with winget"
  }
  Write-Host "  n     Skip Git Bash"
  Write-Host ""

  while ($true) {
    $prompt = if ($wingetAvailable) { "Choice [Y/w/n]" } else { "Choice [Y/n]" }
    $answer = Read-Host $prompt
    if (-not $answer -or $answer -match "^(y|yes)$") {
      return "portable"
    }
    if ($wingetAvailable -and ($answer -match "^(w|winget)$")) {
      return "winget"
    }
    if ($answer -match "^(n|no)$") {
      Write-Host ""
      Write-Host "Will skip Git Bash install."
      return "none"
    }

    Write-Host "Please choose one of the listed keys."
  }
}

function Get-PortableGitAsset {
  $gitArch = Get-WindowsArch
  $assetSuffix = if ($gitArch -eq "arm64") { "arm64.7z.exe" } else { "64-bit.7z.exe" }

  Write-Host "Resolving Portable Git for win-$gitArch"
  $release = Invoke-RestMethod -Uri $GitForWindowsLatestReleaseApi -Headers @{ "User-Agent" = "knightcode-installer" }
  $asset = $release.assets | Where-Object { $_.name -like "PortableGit-*$assetSuffix" } | Select-Object -First 1
  if (-not $asset) {
    Write-Host "No Portable Git binary is available for win-$gitArch."
    exit 1
  }

  $escapedAssetName = [regex]::Escape($asset.name)
  $checksumMatch = [regex]::Match($release.body, "(?m)^$escapedAssetName\s+\|\s+([a-fA-F0-9]{64})\s*$")
  if (-not $checksumMatch.Success) {
    Write-Host "No checksum was found for $($asset.name)."
    exit 1
  }

  return [PSCustomObject]@{
    Name = $asset.name
    Url = $asset.browser_download_url
    Sha256 = $checksumMatch.Groups[1].Value.ToLowerInvariant()
  }
}

function Assert-PortableGitDownloadChecksum {
  param([string]$ExpectedHash, [string]$PortableGitPath)

  $actualHash = (Get-FileHash $PortableGitPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $ExpectedHash) {
    Write-Host "Portable Git download checksum verification failed."
    Write-Host "Expected: $ExpectedHash"
    Write-Host "Actual:   $actualHash"
    exit 1
  }
}

function Install-GitBashWithWinget {
  if (-not (Test-WingetAvailable)) {
    Write-Host "winget.exe was not found."
    exit 1
  }

  Write-Host "Installing Git for Windows globally with winget"
  Write-Host ""
  Write-Host "  winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements"
  Write-Host ""

  & winget.exe install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $installedBash = Find-GitBashInKnownLocations
  if ($installedBash) {
    $configuredShellPath = Get-KnightcodeSettingsShellPath
    if ($configuredShellPath -and (-not (Test-Path $configuredShellPath -PathType Leaf))) {
      Set-KnightcodeSettingsShellPath $installedBash
      Write-Host "KnightCode shellPath set to $installedBash"
    }
    Write-Host "Git Bash installed at $installedBash"
  } else {
    Write-Host "Git for Windows was installed, but KnightCode cannot find bash in this terminal yet."
    Write-Host "Restart your shell before using KnightCode bash commands."
  }
}

function Install-GitBashStandalone {
  $gitDir = Get-KnightcodeManagedGitBashDir
  $gitBashPath = Get-KnightcodeManagedGitBashPath
  if (Test-Path $gitBashPath -PathType Leaf) {
    Set-KnightcodeSettingsShellPath $gitBashPath
    Write-Host "Git Bash configured at $gitBashPath"
    return
  }

  $gitTmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "knightcode-git-bash-$PID"
  $gitExtractDir = Join-Path $gitTmpDir "extract"

  Remove-Item $gitTmpDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $gitTmpDir, $gitExtractDir, (Get-KnightcodeAgentDir) | Out-Null

  $asset = Get-PortableGitAsset
  $portableGitPath = Join-Path $gitTmpDir $asset.Name
  Write-Host "Downloading Portable Git $($asset.Name -replace '^PortableGit-', '' -replace '\.7z\.exe$', '')"
  Invoke-DownloadFile $asset.Url $portableGitPath
  Write-Host "Verifying Portable Git download"
  Assert-PortableGitDownloadChecksum $asset.Sha256 $portableGitPath

  Write-Host "Extracting Portable Git to $gitDir"
  $extractProcess = Start-Process -FilePath $portableGitPath -ArgumentList @("-y", "-o`"$gitExtractDir`"") -PassThru -Wait -WindowStyle Hidden
  if ($extractProcess.ExitCode -ne 0) {
    Write-Host "Portable Git extraction failed."
    exit $extractProcess.ExitCode
  }

  $extractedBashPath = Join-Path (Join-Path $gitExtractDir "bin") "bash.exe"
  if (-not (Test-Path $extractedBashPath -PathType Leaf)) {
    Write-Host "Portable Git extraction did not produce bin\bash.exe."
    exit 1
  }

  Remove-Item $gitDir -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item $gitExtractDir $gitDir -Force
  Remove-Item $gitTmpDir -Recurse -Force

  Set-KnightcodeSettingsShellPath $gitBashPath
  Write-Host "Git Bash installed at $gitDir"
  Write-Host "KnightCode shellPath set to $gitBashPath"
}

function Get-NpmGlobalPrefix {
  $previousOutputEncoding = [Console]::OutputEncoding
  try {
    # npm writes UTF-8 to redirected stdout. Decode it explicitly instead of
    # using the console's OEM code page, which corrupts non-ASCII paths.
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $prefix = (& npm.cmd prefix -g 2>$null).Trim()
    if ($prefix) {
      return $prefix
    }

    return (& npm.cmd config get prefix 2>$null).Trim()
  } finally {
    [Console]::OutputEncoding = $previousOutputEncoding
  }
}

function Test-PathWritableOrCreatable {
  param([string]$Path)

  $checkPath = $Path
  while (-not (Test-Path $checkPath)) {
    $parent = Split-Path $checkPath -Parent
    if (-not $parent -or $parent -eq $checkPath) {
      return $false
    }
    $checkPath = $parent
  }

  if (-not (Test-Path $checkPath -PathType Container)) {
    return $false
  }

  $probe = Join-Path $checkPath ".knightcode-write-test-$PID"
  try {
    New-Item -ItemType File -Path $probe -Force | Out-Null
    Remove-Item $probe -Force
    return $true
  } catch {
    # Windows PowerShell raises the preference-promoted error through
    # ActionPreferenceStopException, so typed catch clauses do not match it.
    if (($_.Exception -is [System.UnauthorizedAccessException]) -or ($_.Exception.InnerException -is [System.UnauthorizedAccessException])) {
      return $false
    }
    throw
  }
}

function Test-NpmPrefixSupportsGlobalInstall {
  param([string]$Prefix)

  return (Test-PathWritableOrCreatable (Join-Path $Prefix "node_modules")) -and (Test-PathWritableOrCreatable $Prefix)
}

function Get-KnightcodeBinDir {
  if ((Test-KnightcodeManagedInstallEnabled) -and $env:KNIGHTCODE_MANAGED_BIN_DIR) {
    return $env:KNIGHTCODE_MANAGED_BIN_DIR
  }
  if ($env:KNIGHTCODE_NPM_INSTALL_PREFIX) {
    return $env:KNIGHTCODE_NPM_INSTALL_PREFIX
  }

  return Get-NpmGlobalPrefix
}

function Get-KnightcodeInstalledPaths {
  $binDir = Get-KnightcodeBinDir
  if ($binDir) {
    return @((Join-Path $binDir "knightcode.cmd"), (Join-Path $binDir "knightcode.ps1"), (Join-Path $binDir "knightcode"))
  }

  return @()
}

function Remove-BlockedKnightcodePowerShellShim {
  $executionPolicy = Get-ExecutionPolicy
  if ($executionPolicy -notin @("Restricted", "AllSigned")) {
    return
  }

  # npm creates both knightcode.cmd and knightcode.ps1, and PowerShell resolves the .ps1 shim
  # first. Under these policies that makes `knightcode` fail even though knightcode.cmd is
  # allowed, so remove only the blocked shim instead of weakening the user's
  # execution policy.
  $binDir = Get-KnightcodeBinDir
  $cmdShim = Join-Path $binDir "knightcode.cmd"
  $powerShellShim = Join-Path $binDir "knightcode.ps1"
  if ((Test-Path $cmdShim -PathType Leaf) -and (Test-Path $powerShellShim -PathType Leaf)) {
    Remove-Item $powerShellShim -Force
    Write-Host "  ok configured KnightCode for PowerShell's $executionPolicy execution policy"
  }
}

function Select-NpmInstallPrefix {
  $npmPrefix = Get-NpmGlobalPrefix
  if ($npmPrefix -and (Test-NpmPrefixSupportsGlobalInstall $npmPrefix)) {
    return ""
  }

  # If an existing global knightcode is present but npm's prefix is not writable, do not
  # install a second copy elsewhere: PATH would likely continue resolving to the
  # old shim, making the successful install look broken.
  $existingGlobalKnightcode = @((Join-Path $npmPrefix "knightcode.cmd"), (Join-Path $npmPrefix "knightcode.ps1")) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($npmPrefix -and $existingGlobalKnightcode) {
    Write-Host "npm's global directory is not writable: $npmPrefix"
    Write-Host "KnightCode is already installed at: $existingGlobalKnightcode"
    Write-Host ""
    Write-Host "Installing another copy under your profile could leave your shell using the old global knightcode, so this installer stopped."
    exit 1
  }

  $userPrefix = Join-Path $env:APPDATA "npm"
  New-Item -ItemType Directory -Force -Path $userPrefix | Out-Null
  return $userPrefix
}

function Select-NpmUninstallPrefix {
  param([string]$ExistingKnightcodePath)

  # On Windows npm creates command shims directly in the prefix directory
  # (knightcode.cmd / knightcode.ps1), unlike Unix where shims live under prefix/bin.
  if (-not $ExistingKnightcodePath) {
    return ""
  }

  $npmPrefix = Get-NpmGlobalPrefix
  if ($npmPrefix -and (($ExistingKnightcodePath -eq (Join-Path $npmPrefix "knightcode.cmd")) -or ($ExistingKnightcodePath -eq (Join-Path $npmPrefix "knightcode.ps1")))) {
    return ""
  }

  if ($env:KNIGHTCODE_NPM_INSTALL_PREFIX -and (($ExistingKnightcodePath -eq (Join-Path $env:KNIGHTCODE_NPM_INSTALL_PREFIX "knightcode.cmd")) -or ($ExistingKnightcodePath -eq (Join-Path $env:KNIGHTCODE_NPM_INSTALL_PREFIX "knightcode.ps1")))) {
    return $env:KNIGHTCODE_NPM_INSTALL_PREFIX
  }

  $fileName = Split-Path $ExistingKnightcodePath -Leaf
  if ($fileName -in @("knightcode.cmd", "knightcode.ps1", "knightcode")) {
    return (Split-Path $ExistingKnightcodePath -Parent)
  }

  return ""
}

function Get-KnightcodeManagedInstallMarkerPath {
  param([string]$ManagedRoot)

  return Join-Path $ManagedRoot $KnightcodeManagedInstallMarker
}

function Test-KnightcodeManagedInstallMarker {
  param([string]$ManagedRoot)

  if (-not $ManagedRoot) {
    return $false
  }
  $markerPath = Get-KnightcodeManagedInstallMarkerPath $ManagedRoot
  if (-not (Test-Path $markerPath -PathType Leaf)) {
    return $false
  }

  $markerScript = @'
const fs = require("node:fs");
const marker = JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
if (
	marker.kind !== "knightcode-managed-install" ||
	marker.schemaVersion !== 1 ||
	marker.layout !== "releases-v1"
) {
	process.exit(1);
}
'@
  $markerScript | & node - $markerPath *> $null
  return $LASTEXITCODE -eq 0
}

function Get-KnightcodeManagedInstallRootForCommand {
  param([string]$CommandPath)

  if (-not $CommandPath) {
    return ""
  }
  $fileName = Split-Path $CommandPath -Leaf
  if ($fileName -notin @("knightcode", "knightcode.cmd", "knightcode.ps1")) {
    return ""
  }

  $binDir = Split-Path ([System.IO.Path]::GetFullPath($CommandPath)) -Parent
  $agentDir = Split-Path $binDir -Parent
  $managedRoot = Join-Path $agentDir "install"
  if (Test-KnightcodeManagedInstallMarker $managedRoot) {
    return $managedRoot
  }
  return ""
}

function Select-KnightcodeManagedInstallDir {
  param([string]$ExistingKnightcodePath)

  if ($env:KNIGHTCODE_MANAGED_INSTALL_ROOT) {
    $managedRoot = [System.IO.Path]::GetFullPath($env:KNIGHTCODE_MANAGED_INSTALL_ROOT)
    if (Test-KnightcodeManagedInstallMarker $managedRoot) {
      return $managedRoot
    }
  }

  $managedRoot = Get-KnightcodeManagedInstallRootForCommand $ExistingKnightcodePath
  if ($managedRoot) {
    return $managedRoot
  }

  return Join-Path (Get-KnightcodeManagedDefaultAgentDir) "install"
}

function Get-NpmUninstallKnightcodeCommand {
  if ($env:KNIGHTCODE_NPM_UNINSTALL_PREFIX) {
    return "npm.cmd uninstall -g --prefix `"$env:KNIGHTCODE_NPM_UNINSTALL_PREFIX`" $KnightcodePackage"
  }
  return "npm.cmd uninstall -g $KnightcodePackage"
}

function Write-KnightcodeInstallCommand {
  if ($env:KNIGHTCODE_LEGACY_NPM_MIGRATION -eq "1") {
    $knightcodeCommand = Join-Path $env:KNIGHTCODE_MANAGED_BIN_DIR "knightcode.cmd"
    return "KnightCode will install to $knightcodeCommand, then remove the npm package:`n  $(Get-NpmUninstallKnightcodeCommand)"
  }
  if (Test-KnightcodeManagedInstallEnabled) {
    $knightcodeCommand = Join-Path $env:KNIGHTCODE_MANAGED_BIN_DIR "knightcode.cmd"
    return "KnightCode will install to $knightcodeCommand"
  }
  if ($env:KNIGHTCODE_NPM_INSTALL_PREFIX) {
    return "Using legacy self managed installation`n  npm.cmd install -g --ignore-scripts $NpmMinReleaseAgeArg --prefix `"$env:KNIGHTCODE_NPM_INSTALL_PREFIX`" $KnightcodePackage"
  }
  return "Using legacy self managed installation`n  npm.cmd install -g --ignore-scripts $NpmMinReleaseAgeArg $KnightcodePackage"
}

function Write-KnightcodeActionMenu {
  param([string]$ExistingKnightcodePath)

  $reset = ""
  $dim = ""
  $bold = ""
  $cyan = ""
  $green = ""
  $red = ""
  if (Test-InstallerAnsiOutput) {
    $reset = "${KnightcodeEsc}[0m"
    $dim = "${KnightcodeEsc}[2m"
    $bold = "${KnightcodeEsc}[1m"
    $cyan = "${KnightcodeEsc}[36m"
    $green = "${KnightcodeEsc}[32m"
    $red = "${KnightcodeEsc}[31m"
  }

  if ($ExistingKnightcodePath) {
    Write-Host "${bold}KnightCode is already installed at:${reset}"
    Write-Host ""
    Write-Host "  $ExistingKnightcodePath"
    Write-Host ""
  }

  if ($env:KNIGHTCODE_NPM_INSTALL_PREFIX) {
    Write-Host "npm's global directory is not writable; KnightCode will be installed under $env:KNIGHTCODE_NPM_INSTALL_PREFIX."
    Write-Host ""
  }

  if ($env:KNIGHTCODE_LEGACY_NPM_MIGRATION -eq "1") {
    Write-Host "This KnightCode was installed with npm. KnightCode now uses a managed installation"
    Write-Host "that pins all dependencies and updates itself with: knightcode update"
    Write-Host ""
    Write-Host "${bold}Migration:${reset}"
  } elseif (Test-KnightcodeManagedInstallEnabled) {
    if ($ExistingKnightcodePath) {
      Write-Host "${bold}Reinstallation:${reset}"
    } else {
      Write-Host "${bold}Installation:${reset}"
    }
  } elseif ($ExistingKnightcodePath) {
    Write-Host "${bold}Reinstall command:${reset}"
  } else {
    Write-Host "${bold}Install command:${reset}"
  }
  Write-Host ""
  Write-Host "  $(Write-KnightcodeInstallCommand)"
  Write-Host ""

  Write-Host "${bold}Choose an action:${reset}"
  Write-Host ""
  if ($env:KNIGHTCODE_LEGACY_NPM_MIGRATION -eq "1") {
    Write-Host ("  {0}{1,-4}{2} {3}Migrate KnightCode to a managed installation{2} {4}(default){2}" -f $cyan, "y", $reset, $green, $dim)
    Write-Host ("  {0}{1,-4}{2} {3}Uninstall KnightCode{2}" -f $cyan, "u", $reset, $red)
  } elseif ($ExistingKnightcodePath) {
    Write-Host ("  {0}{1,-4}{2} {3}Reinstall KnightCode{2} {4}(default){2}" -f $cyan, "y", $reset, $green, $dim)
    Write-Host ("  {0}{1,-4}{2} {3}Uninstall KnightCode{2}" -f $cyan, "u", $reset, $red)
  } else {
    Write-Host ("  {0}{1,-4}{2} {3}Install KnightCode{2} {4}(default){2}" -f $cyan, "y", $reset, $green, $dim)
  }
  Write-Host ("  {0}{1,-4}{2} {3}Do nothing{2}" -f $cyan, "n", $reset, $dim)
}

function Read-KnightcodeActionKey {
  $keyInfo = [Console]::ReadKey($true)
  if ($keyInfo.Key -eq [ConsoleKey]::Enter) {
    return ""
  }
  if ($keyInfo.Key -eq [ConsoleKey]::Spacebar) {
    return " "
  }
  if ($keyInfo.Key -eq [ConsoleKey]::Escape) {
    return $KnightcodeEsc
  }
  return [string]$keyInfo.KeyChar
}

function Get-DefaultKnightcodeAction {
  param([string]$ExistingKnightcodePath)

  if ($env:KNIGHTCODE_LEGACY_NPM_MIGRATION -eq "1") {
    return "migrate"
  }
  if ($ExistingKnightcodePath) {
    return "reinstall"
  }
  return "install"
}

function Write-KnightcodeActionSelection {
  param([string]$Action)

  switch ($Action) {
    "install" { $message = "Will install KnightCode." }
    "reinstall" { $message = "Will reinstall KnightCode." }
    "migrate" { $message = "Will migrate KnightCode to a managed installation." }
    "uninstall" { $message = "Will uninstall KnightCode." }
    "none" { $message = "Chose to do nothing. Exiting." }
  }
  Write-Host ""
  Write-Host $message
  if ($Action -in @("install", "reinstall", "migrate")) {
    Write-Host "This will take a while. We're sorry."
  }
  Write-Host ""
}

function Choose-KnightcodeAction {
  param([string]$ExistingKnightcodePath)

  Write-KnightcodeActionMenu $ExistingKnightcodePath
  Write-Host ""

  if (-not (Test-InstallerInteractiveInput)) {
    Write-Host "No terminal detected; continuing without confirmation."
    $action = Get-DefaultKnightcodeAction $ExistingKnightcodePath
    Write-KnightcodeActionSelection $action
    return $action
  }

  while ($true) {
    $key = Read-KnightcodeActionKey

    if (($key -eq "") -or ($key -eq " ")) {
      $action = Get-DefaultKnightcodeAction $ExistingKnightcodePath
      break
    }
    if ($key -match "^(y|Y)$") {
      $action = Get-DefaultKnightcodeAction $ExistingKnightcodePath
      break
    }
    if ($ExistingKnightcodePath -and ($key -match "^(u|U)$")) {
      $action = "uninstall"
      break
    }
    if (($key -match "^(n|N)$") -or ($key -eq $KnightcodeEsc)) {
      $action = "none"
      break
    }

    Write-Host "Please choose one of the listed keys."
  }

  Write-KnightcodeActionSelection $action
  return $action
}

function Get-NpmInstallKnightcodeArgs {
  param([string]$LogLevel, [string]$Progress)

  $args = @("install", "-g", "--ignore-scripts", $NpmMinReleaseAgeArg, "--no-fund", "--no-audit", "--loglevel=$LogLevel", "--progress=$Progress")
  if ($env:KNIGHTCODE_NPM_INSTALL_PREFIX) {
    $args += @("--prefix", $env:KNIGHTCODE_NPM_INSTALL_PREFIX)
  }
  $args += $KnightcodePackage
  return $args
}

function Invoke-NpmInstallKnightcode {
  param([string]$LogLevel)

  $args = Get-NpmInstallKnightcodeArgs $LogLevel "false"
  & npm.cmd @args
}

function Invoke-DownloadManagedInstallerArtifact {
  param([string]$Url, [string]$Output, [string]$Label)

  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Output | Out-Null
    return $true
  } catch {
    Remove-Item $Output -Force -ErrorAction SilentlyContinue
    if ($_.Exception.Response) {
      $httpStatus = [int]$_.Exception.Response.StatusCode
      Write-Host "Managed installer $Label is unavailable at $Url (HTTP $httpStatus)."
    } else {
      Write-Host "Could not download $Label from $Url."
    }
    return $false
  }
}

function Get-KnightcodeManagedReleaseVersion {
  param([string]$MetadataPath)

  $metadataScript = @'
const fs = require("node:fs");
const metadata = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const version = metadata.version;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
	throw new Error("managed installer metadata has an invalid version");
}
console.log(version);
'@
  $version = $metadataScript | & node - $MetadataPath
  if ($LASTEXITCODE -ne 0) {
    return ""
  }
  return ("$version").Trim()
}

function Test-KnightcodeManagedInstallArtifacts {
  param([string]$PackageJsonPath, [string]$PackageLockPath, [string]$ManagedVersion)

  $validationScript = @'
const fs = require("node:fs");
const packageJson = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const packageLock = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const knightcodePackage = process.argv[4];
const version = process.argv[5];
const root = packageLock.packages?.[""];
const knightcodeEntry = packageLock.packages?.[`node_modules/${knightcodePackage}`];

if (packageJson.version !== version || packageJson.dependencies?.[knightcodePackage] !== version) {
	throw new Error(`managed installer package.json must describe ${knightcodePackage}@${version}`);
}
if (packageLock.lockfileVersion !== 3) {
	throw new Error("managed installer package-lock.json must use lockfileVersion 3");
}
if (packageLock.version !== version || root?.version !== version || root?.dependencies?.[knightcodePackage] !== version) {
	throw new Error(`managed installer package-lock.json root must describe ${knightcodePackage}@${version}`);
}
if (knightcodeEntry?.version !== version) {
	throw new Error(`managed installer package-lock.json does not include ${knightcodePackage}@${version}`);
}
'@
  $validationScript | & node - $PackageJsonPath $PackageLockPath $KnightcodePackage $ManagedVersion
  return $LASTEXITCODE -eq 0
}

function Receive-KnightcodeManagedInstallArtifacts {
  param([string]$ManagedStageDir)

  $metadataPath = Join-Path $ManagedStageDir "metadata.json"
  Write-Host "Downloading managed installer release metadata"
  if (-not (Invoke-DownloadManagedInstallerArtifact "$KnightcodeInstallerApiBase/latest" $metadataPath "release metadata")) {
    return $false
  }

  $managedVersion = Get-KnightcodeManagedReleaseVersion $metadataPath
  if (-not $managedVersion) {
    Write-Host "Managed installer release metadata is invalid."
    return $false
  }

  $packageJsonPath = Join-Path $ManagedStageDir "package.json"
  Write-Host "Downloading managed installer package.json for KnightCode $managedVersion"
  if (-not (Invoke-DownloadManagedInstallerArtifact "$KnightcodeInstallerApiBase/$managedVersion/package.json" $packageJsonPath "package.json")) {
    return $false
  }

  $packageLockPath = Join-Path $ManagedStageDir "package-lock.json"
  Write-Host "Downloading managed installer package-lock.json for KnightCode $managedVersion"
  if (-not (Invoke-DownloadManagedInstallerArtifact "$KnightcodeInstallerApiBase/$managedVersion/package-lock.json" $packageLockPath "package-lock.json")) {
    return $false
  }

  if (-not (Test-KnightcodeManagedInstallArtifacts $packageJsonPath $packageLockPath $managedVersion)) {
    return $false
  }
  $global:KnightcodeManagedVersion = $managedVersion
  return $true
}

function Write-KnightcodeManagedFile {
  param([string]$Path, [string]$Content)

  $temporaryPath = "$Path.tmp.$PID"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($temporaryPath, $Content, $utf8NoBom)
  Move-Item $temporaryPath $Path -Force
}

function Write-KnightcodeManagedInstallMarker {
  param([string]$ManagedRoot, [string]$ManagedBinDir)

  $marker = [ordered]@{
    kind = "knightcode-managed-install"
    schemaVersion = 1
    layout = "releases-v1"
    entrypoint = [ordered]@{
      type = "script"
      path = Join-Path $ManagedBinDir "knightcode.cmd"
    }
  }
  $markerJson = ($marker | ConvertTo-Json -Depth 5) + "`r`n"
  Write-KnightcodeManagedFile (Get-KnightcodeManagedInstallMarkerPath $ManagedRoot) $markerJson
}

function Write-KnightcodeManagedLaunchers {
  param([string]$ManagedAgentDir)

  $managedBinDir = Join-Path $ManagedAgentDir "bin"
  New-Item -ItemType Directory -Force -Path $managedBinDir | Out-Null

  $launcherJsPath = Join-Path $managedBinDir "knightcode-launcher.js"
  $shellLauncherPath = Join-Path $managedBinDir "knightcode"
  $cmdLauncherPath = Join-Path $managedBinDir "knightcode.cmd"
  $powerShellLauncherPath = Join-Path $managedBinDir "knightcode.ps1"
  foreach ($launcherPath in @($launcherJsPath, $shellLauncherPath, $cmdLauncherPath, $powerShellLauncherPath)) {
    if ((Test-Path $launcherPath) -and (-not (Test-Path $launcherPath -PathType Leaf))) {
      throw "Managed KnightCode launcher path is not a file: $launcherPath"
    }
  }

  $launcherJs = @'
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageName = __KNIGHTCODE_PACKAGE__;
const commandName = __KNIGHTCODE_COMMAND__;
const agentDir = path.dirname(__dirname);
const installRoot = path.join(agentDir, "install");
const currentFile = path.join(installRoot, "current-version");
const currentVersion = fs.readFileSync(currentFile, "utf8").trim();
if (!currentVersion || currentVersion === "." || currentVersion === ".." || !/^[0-9A-Za-z._+-]+$/.test(currentVersion)) {
	throw new Error(`Managed KnightCode version file is invalid: ${currentFile}`);
}

const releaseDir = path.join(installRoot, "releases", currentVersion);
const packageDir = path.join(releaseDir, "node_modules", ...packageName.split("/"));
const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
const binPath = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[commandName];
if (!binPath) {
	throw new Error(`${packageName} does not declare a ${commandName} bin`);
}
const cliPath = path.resolve(packageDir, binPath);
const cliRelative = path.relative(packageDir, cliPath);
if (cliRelative.startsWith("..") || path.isAbsolute(cliRelative) || !fs.statSync(cliPath).isFile()) {
	throw new Error(`Managed KnightCode executable is invalid: ${cliPath}`);
}

const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
	stdio: "inherit",
	env: { ...process.env, KNIGHTCODE_MANAGED_INSTALL_ROOT: installRoot },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
'@
  $launcherJs = $launcherJs.Replace("__KNIGHTCODE_PACKAGE__", ($KnightcodePackage | ConvertTo-Json -Compress))
  $launcherJs = $launcherJs.Replace("__KNIGHTCODE_COMMAND__", ($KnightcodeCmd | ConvertTo-Json -Compress))
  # Remember whether this install used standalone Node. A new Windows shell
  # puts machine PATH first, so PATH alone cannot preserve that choice.
  $standaloneNode = Join-Path $env:LOCALAPPDATA "knightcode-node\current\node.exe"
  $shellNodeSetup = 'node=node'
  $cmdNodeSetup = 'SET "node=node"'
  $powerShellNodeSetup = '$node="node"'
  if ((Get-Command node).Source -eq $standaloneNode) {
    # Fall back only if the executable was removed, never on a KnightCode failure.
    $shellNodeSetup = @'
node='__KNIGHTCODE_STANDALONE_NODE__'
if [ ! -f "$node" ]; then
  node=node
fi
'@
    # Normalize and shell-quote once during installation, not on every launch.
    $shellNodeSetup = $shellNodeSetup.Replace("__KNIGHTCODE_STANDALONE_NODE__", $standaloneNode.Replace("\", "/").Replace("'", "'\''"))
    $cmdNodeSetup = @'
SET "node=node"
IF EXIST "%LOCALAPPDATA%\knightcode-node\current\node.exe" SET "node=%LOCALAPPDATA%\knightcode-node\current\node.exe"
'@
    $powerShellNodeSetup = @'
$node="node"
$standaloneNode=Join-Path $env:LOCALAPPDATA "knightcode-node/current/node.exe"
if (Test-Path $standaloneNode -PathType Leaf) {
  $node=$standaloneNode
}
'@
  }

  $shellLauncher = @'
#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")
__KNIGHTCODE_NODE_SETUP__
# A successful exec replaces this shell, so KnightCode exit codes never run this trap.
trap 'status=$?
if [ "$status" -eq 127 ]; then
  printf "%s\n" "KnightCode could not find Node.js. Install Node.js 22.19.0 or newer, or rerun the installer at https://knightcode.dev." >&2
fi
exit "$status"' 0
exec "$node" "$basedir/knightcode-launcher.js" "$@"
'@
  $shellLauncher = $shellLauncher.Replace("__KNIGHTCODE_NODE_SETUP__", $shellNodeSetup)
  $cmdLauncher = @'
@ECHO off
SETLOCAL
__KNIGHTCODE_NODE_SETUP__
"%node%" "%~dp0knightcode-launcher.js" %*
SET "knightcode_exit_code=%ERRORLEVEL%"
IF "%knightcode_exit_code%"=="9009" (
  IF "%node%"=="node" (
    "%SystemRoot%\System32\where.exe" /Q node
    IF ERRORLEVEL 1 GOTO node_missing
  ) ELSE IF NOT EXIST "%node%" GOTO node_missing
)
EXIT /B %knightcode_exit_code%
:node_missing
ECHO KnightCode could not find Node.js. Install Node.js 22.19.0 or newer, or rerun the installer at https://knightcode.dev. 1>&2
EXIT /B %knightcode_exit_code%
'@
  $cmdLauncher = $cmdLauncher.Replace("__KNIGHTCODE_NODE_SETUP__", $cmdNodeSetup)
  $powerShellLauncher = @'
#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent
$launcher=Join-Path $basedir "knightcode-launcher.js"
__KNIGHTCODE_NODE_SETUP__
try {
  if ($MyInvocation.ExpectingInput) {
    $input | & $node $launcher $args
  } else {
    & $node $launcher $args
  }
} catch [System.Management.Automation.CommandNotFoundException] {
  [Console]::Error.WriteLine("KnightCode could not find Node.js. Install Node.js 22.19.0 or newer, or rerun the installer at https://knightcode.dev.")
  exit 127
}
exit $LASTEXITCODE
'@
  $powerShellLauncher = $powerShellLauncher.Replace("__KNIGHTCODE_NODE_SETUP__", $powerShellNodeSetup)

  # The caller verified ownership; rewrite launchers to repair existing installs.
  Write-KnightcodeManagedFile $launcherJsPath ($launcherJs + "`r`n")
  Write-KnightcodeManagedFile $shellLauncherPath ($shellLauncher + "`n")
  Write-KnightcodeManagedFile $cmdLauncherPath ($cmdLauncher + "`r`n")
  Write-KnightcodeManagedFile $powerShellLauncherPath ($powerShellLauncher + "`r`n")
}

function Write-KnightcodeManagedCurrentVersion {
  param([string]$ManagedRoot, [string]$ManagedVersion)

  Write-KnightcodeManagedFile (Join-Path $ManagedRoot "current-version") "$ManagedVersion`r`n"
}

function Invoke-KnightcodeManagedInstall {
  param([string]$LogLevel)

  $managedRoot = $env:KNIGHTCODE_MANAGED_INSTALL_DIR
  $managedAgentDir = $env:KNIGHTCODE_MANAGED_AGENT_DIR
  $markerPath = Get-KnightcodeManagedInstallMarkerPath $managedRoot

  if (($env:KNIGHTCODE_INSTALL_ACTION -ne "migrate") -and $env:KNIGHTCODE_EXISTING_PATH) {
    $existingRoot = Get-KnightcodeManagedInstallRootForCommand $env:KNIGHTCODE_EXISTING_PATH
    if ((-not $existingRoot) -or ($existingRoot -ne $managedRoot)) {
      Write-Host "Managed install refused to replace KnightCode at $env:KNIGHTCODE_EXISTING_PATH. Uninstall it first."
      $global:LASTEXITCODE = 1
      return
    }
  }
  if ((Test-Path $markerPath) -and (-not (Test-KnightcodeManagedInstallMarker $managedRoot))) {
    Write-Host "The managed install marker at $markerPath is invalid."
    $global:LASTEXITCODE = 1
    return
  }

  $managedBinDir = Join-Path $managedAgentDir "bin"
  $managedLauncher = Join-Path $managedBinDir "knightcode.cmd"
  $launcherPaths = @(
    (Join-Path $managedBinDir "knightcode"),
    $managedLauncher,
    (Join-Path $managedBinDir "knightcode.ps1"),
    (Join-Path $managedBinDir "knightcode-launcher.js")
  )
  if (($launcherPaths | Where-Object { Test-Path $_ } | Select-Object -First 1) -and (-not (Test-KnightcodeManagedInstallMarker $managedRoot))) {
    Write-Host "Refusing to replace the unrecognized executable at $managedLauncher."
    $global:LASTEXITCODE = 1
    return
  }

  $managedStagingRoot = Join-Path $managedRoot "staging"
  $managedReleasesRoot = Join-Path $managedRoot "releases"
  New-Item -ItemType Directory -Force -Path $managedStagingRoot, $managedReleasesRoot | Out-Null
  $managedStageDir = Join-Path $managedStagingRoot "install-$PID-$([DateTime]::UtcNow.Ticks)"
  Remove-Item $managedStageDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $managedStageDir | Out-Null

  try {
    if (-not (Receive-KnightcodeManagedInstallArtifacts $managedStageDir)) {
      $global:LASTEXITCODE = 1
      return
    }
    $managedVersion = $global:KnightcodeManagedVersion

    Write-Host "Installing managed KnightCode dependencies"
    $npmArgs = @("ci", "--ignore-scripts", $NpmMinReleaseAgeArg, "--omit=dev", "--include=optional", "--no-fund", "--no-audit", "--loglevel=$LogLevel", "--progress=false")
    Push-Location $managedStageDir
    # Windows PowerShell promotes redirected native stderr to error records. npm
    # writes normal verbose progress there, so rely on its checked exit status.
    $savedErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      & npm.cmd @npmArgs
      $managedStatus = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $savedErrorActionPreference
      Pop-Location
    }
    if ($managedStatus -ne 0) {
      $global:LASTEXITCODE = $managedStatus
      return
    }

    $managedStagedBin = Join-Path $managedStageDir "node_modules\.bin\knightcode.cmd"
    if (-not (Test-Path $managedStagedBin -PathType Leaf)) {
      Write-Host "Managed KnightCode executable was not created by npm ci."
      $global:LASTEXITCODE = 1
      return
    }

    Write-Host "Verifying managed KnightCode $managedVersion"
    $managedInstalledVersion = & $managedStagedBin --version
    $managedStatus = $LASTEXITCODE
    if ($managedStatus -ne 0) {
      $global:LASTEXITCODE = $managedStatus
      return
    }
    $managedInstalledVersion = ("$managedInstalledVersion").Trim()
    if ($managedInstalledVersion -ne $managedVersion) {
      Write-Host "Managed KnightCode smoke test returned version $managedInstalledVersion; expected $managedVersion."
      $global:LASTEXITCODE = 1
      return
    }

    $managedReleaseDir = Join-Path $managedReleasesRoot $managedVersion
    Write-Host "Activating managed KnightCode $managedVersion"
    if (Test-Path $managedReleaseDir -PathType Container) {
      Remove-Item $managedStageDir -Recurse -Force
    } else {
      Move-Item $managedStageDir $managedReleaseDir
    }

    # Remove the npm-installed KnightCode only after the managed release is verified, so
    # a failed download or npm ci leaves the existing installation working.
    if ($env:KNIGHTCODE_INSTALL_ACTION -eq "migrate") {
      Remove-KnightcodeLegacyNpmInstall
      if ($LASTEXITCODE -ne 0) {
        return
      }
    }

    Write-KnightcodeManagedInstallMarker $managedRoot $env:KNIGHTCODE_MANAGED_BIN_DIR
    Write-KnightcodeManagedLaunchers $managedAgentDir
    Write-KnightcodeManagedCurrentVersion $managedRoot $managedVersion
    $global:LASTEXITCODE = 0
    Write-Host "Managed KnightCode install complete"
  } finally {
    Remove-Item $managedStageDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-KnightcodeInstall {
  param([string]$LogLevel)

  if (Test-KnightcodeManagedInstallEnabled) {
    Invoke-KnightcodeManagedInstall $LogLevel
  } else {
    Invoke-NpmInstallKnightcode $LogLevel
  }
}

function Install-KnightcodePackageWithProgress {
  $logFile = Join-Path ([System.IO.Path]::GetTempPath()) "knightcode-installer-npm-$PID.log"
  Remove-Item $logFile -Force -ErrorAction SilentlyContinue
  New-Item -ItemType File -Path $logFile -Force | Out-Null

  $managedInstall = Test-KnightcodeManagedInstallEnabled
  if ($managedInstall) {
    $installFunctionNames = @(
      "Test-KnightcodeManagedInstallEnabled",
      "Get-NpmInstallKnightcodeArgs",
      "Invoke-NpmInstallKnightcode",
      "Get-KnightcodeManagedInstallMarkerPath",
      "Test-KnightcodeManagedInstallMarker",
      "Get-KnightcodeManagedInstallRootForCommand",
      "Invoke-DownloadManagedInstallerArtifact",
      "Get-KnightcodeManagedReleaseVersion",
      "Test-KnightcodeManagedInstallArtifacts",
      "Receive-KnightcodeManagedInstallArtifacts",
      "Write-KnightcodeManagedFile",
      "Write-KnightcodeManagedInstallMarker",
      "Write-KnightcodeManagedLaunchers",
      "Write-KnightcodeManagedCurrentVersion",
      "Invoke-NpmUninstallKnightcode",
      "Remove-KnightcodeLegacyNpmInstall",
      "Invoke-KnightcodeManagedInstall",
      "Invoke-KnightcodeInstall"
    )
    $workerSource = ($installFunctionNames | ForEach-Object {
      "function $_ {`n$((Get-Item "function:$_").Definition)`n}"
    }) -join "`r`n"
    $job = Start-Job -ScriptBlock {
      param(
        [string]$FunctionSource,
        [string]$Package,
        [string]$Command,
        [string]$InstallerApiBase,
        [string]$ManagedInstallMarker,
        [string]$MinReleaseAgeArg,
        [string]$OutputLog
      )

      $ErrorActionPreference = "Stop"
      $global:KnightcodePackage = $Package
      $global:KnightcodeCmd = $Command
      $global:KnightcodeInstallerApiBase = $InstallerApiBase
      $global:KnightcodeManagedInstallMarker = $ManagedInstallMarker
      $global:NpmMinReleaseAgeArg = $MinReleaseAgeArg
      try {
        . ([ScriptBlock]::Create($FunctionSource))
        Invoke-KnightcodeInstall "verbose" *> $OutputLog
        $LASTEXITCODE
      } catch {
        $failureMessage = "Managed install worker failed: $($_.Exception.Message)"
        $failureMessage | Out-File -FilePath $OutputLog -Append
        1
      }
    } -ArgumentList $workerSource, $KnightcodePackage, $KnightcodeCmd, $KnightcodeInstallerApiBase, $KnightcodeManagedInstallMarker, $NpmMinReleaseAgeArg, $logFile
  } else {
    $npmArgs = [System.Collections.ArrayList]::new()
    $npmArgs.AddRange([string[]](Get-NpmInstallKnightcodeArgs "verbose" "false"))
    $job = Start-Job -ScriptBlock {
      param([string[]]$ArgsForNpm, [string]$OutputLog)

      & npm.cmd @ArgsForNpm *> $OutputLog
      $LASTEXITCODE
    } -ArgumentList $npmArgs, $logFile
  }

  [Console]::Write("${KnightcodeEsc}[?25l")
  $script:KnightcodeLastProgressWidth = 0
  $step = 0
  $label = if ($managedInstall) { "starting managed install" } else { "starting npm install" }
  $lastFrame = $null
  $lastLabel = $null
  $redrawIntervalMs = 180
  while ($job.State -eq "Running") {
    $frame = Get-SpinnerFrame $step
    if (($step % 3) -eq 0) {
      $label = Get-NpmInstallProgressLabel $logFile $label
    }
    if (($frame -ne $lastFrame) -or ($label -ne $lastLabel)) {
      Write-InstallProgress $step $frame $label "Installing KnightCode"
      $lastFrame = $frame
      $lastLabel = $label
    }
    $step += 1
    Start-Sleep -Milliseconds $redrawIntervalMs
  }

  $jobErrors = @()
  $status = Receive-Job $job -ErrorAction SilentlyContinue -ErrorVariable +jobErrors | Select-Object -Last 1
  if (($job.State -eq "Failed") -or ($null -eq $status)) {
    $status = 1
    if ($jobErrors) {
      "Managed install worker failed: $($jobErrors[-1].Exception.Message)" | Out-File -FilePath $logFile -Append
    }
  }
  Remove-Job $job
  Finish-InstallProgress

  if ($status -ne 0) {
    [Console]::Write("${KnightcodeEsc}[31mInstallation failed.${KnightcodeEsc}[0m`n`n")
    Get-Content $logFile | ForEach-Object { Write-Host $_ }
    Remove-Item $logFile -Force -ErrorAction SilentlyContinue
    exit $status
  }

  Remove-Item $logFile -Force -ErrorAction SilentlyContinue
  if ($managedInstall) {
    Write-Host "  ok install complete"
  } else {
    Write-Host "  ok npm install complete"
  }
}

function Invoke-NpmUninstallKnightcode {
  $args = @("uninstall", "-g", "--no-fund", "--no-audit", "--loglevel=error", "--progress=false")
  if ($env:KNIGHTCODE_NPM_UNINSTALL_PREFIX) {
    $args += @("--prefix", $env:KNIGHTCODE_NPM_UNINSTALL_PREFIX)
  }
  $args += $KnightcodePackage
  # Windows PowerShell promotes redirected native stderr to error records. Rely
  # on npm's exit status instead.
  $savedErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & npm.cmd @args
  } finally {
    $ErrorActionPreference = $savedErrorActionPreference
  }
}

function Remove-KnightcodeLegacyNpmInstall {
  Write-Host "Removing npm-installed KnightCode"
  Invoke-NpmUninstallKnightcode
  if ($LASTEXITCODE -ne 0) {
    Write-Host "npm uninstall failed. Close any running knightcode processes and run this installer again."
    $global:LASTEXITCODE = 1
    return
  }
  if (Test-Path $env:KNIGHTCODE_EXISTING_PATH) {
    Write-Host "npm uninstall finished, but knightcode is still present at $env:KNIGHTCODE_EXISTING_PATH."
    $global:LASTEXITCODE = 1
    return
  }
  $global:LASTEXITCODE = 0
}

function Assert-KnightcodeLegacyNpmInstallRemovable {
  $legacyPrefix = if ($env:KNIGHTCODE_NPM_UNINSTALL_PREFIX) { $env:KNIGHTCODE_NPM_UNINSTALL_PREFIX } else { Get-NpmGlobalPrefix }
  if ($legacyPrefix -and (Test-NpmPrefixSupportsGlobalInstall $legacyPrefix)) {
    return
  }

  Write-Host "npm's global directory is not writable, so the npm-installed KnightCode at $env:KNIGHTCODE_EXISTING_PATH cannot be removed."
  Write-Host "Remove it from an elevated terminal, then run this installer again:"
  Write-Host ""
  Write-Host "  $(Get-NpmUninstallKnightcodeCommand)"
  exit 1
}

function Test-NpmPackageInstalledForUninstall {
  $args = @("ls", "-g", "--depth=0")
  if ($env:KNIGHTCODE_NPM_UNINSTALL_PREFIX) {
    $args += @("--prefix", $env:KNIGHTCODE_NPM_UNINSTALL_PREFIX)
  }
  $args += $KnightcodePackage
  $savedErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & npm.cmd @args *> $null
  } finally {
    $ErrorActionPreference = $savedErrorActionPreference
  }
  return $LASTEXITCODE -eq 0
}

function Install-KnightcodePackage {
  if (Test-InstallerAnsiOutput) {
    Install-KnightcodePackageWithProgress
  } else {
    Write-Host "Installing KnightCode..."
    Write-Host ""
    Invoke-KnightcodeInstall "error"
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
}

function Uninstall-KnightcodePackage {
  $managedRoot = Get-KnightcodeManagedInstallRootForCommand $env:KNIGHTCODE_EXISTING_PATH
  if ($managedRoot) {
    Write-Host "Uninstalling managed KnightCode..."
    Write-Host ""
    $managedAgentDir = Split-Path $managedRoot -Parent
    $managedBinDir = Join-Path $managedAgentDir "bin"
    Remove-Item (Join-Path $managedBinDir "knightcode"), (Join-Path $managedBinDir "knightcode.cmd"), (Join-Path $managedBinDir "knightcode.ps1"), (Join-Path $managedBinDir "knightcode-launcher.js") -Force -ErrorAction SilentlyContinue
    Remove-Item $managedRoot -Recurse -Force

    if (Test-Path $env:KNIGHTCODE_EXISTING_PATH) {
      Write-Host ""
      Write-Host "Managed uninstall finished, but knightcode is still present at:"
      Write-Host ""
      Write-Host "  $env:KNIGHTCODE_EXISTING_PATH"
      exit 1
    }
    return
  }

  if (-not (Test-NpmPackageInstalledForUninstall)) {
    Write-Host "I found knightcode at:"
    Write-Host ""
    Write-Host "  $env:KNIGHTCODE_EXISTING_PATH"
    Write-Host ""
    Write-Host "but npm does not show $KnightcodePackage installed there."
    Write-Host "Nothing was removed."
    exit 1
  }

  Write-Host "Uninstalling KnightCode..."
  Write-Host ""
  Invoke-NpmUninstallKnightcode
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  if ((Test-Path $env:KNIGHTCODE_EXISTING_PATH) -or (Test-Path $env:KNIGHTCODE_EXISTING_PATH -PathType Leaf)) {
    Write-Host ""
    Write-Host "npm uninstall finished, but knightcode is still present at:"
    Write-Host ""
    Write-Host "  $env:KNIGHTCODE_EXISTING_PATH"
    exit 1
  }
}

function Test-InstalledKnightcodeIsFirstOnPath {
  $installedKnightcodePaths = Get-KnightcodeInstalledPaths
  if (-not $installedKnightcodePaths) {
    return $false
  }

  $activeKnightcode = Get-Command $KnightcodeCmd -ErrorAction SilentlyContinue
  return $activeKnightcode -and ($installedKnightcodePaths -contains $activeKnightcode.Source)
}

function Write-KnightcodeNotOnPathMessage {
  $knightcodeBinDir = Get-KnightcodeBinDir
  $activeKnightcode = Get-Command $KnightcodeCmd -ErrorAction SilentlyContinue

  Write-Host "KnightCode was installed, but your shell is not using that install yet."
  if ($activeKnightcode) {
    Write-Host "Your shell currently resolves knightcode to: $($activeKnightcode.Source)"
  }

  if ($knightcodeBinDir) {
    $answer = Read-Host "Add $knightcodeBinDir to your user PATH now? [Y/n]"
    if (-not $answer -or $answer -notmatch "^(n|no)$") {
      Add-UserPathEntry $knightcodeBinDir -Prepend
      Write-Host "Added $knightcodeBinDir to your user PATH."
    }
    Write-Host "Restart your shell, then run: knightcode"
  } else {
    Write-Host "Check npm's global prefix with: npm prefix -g"
    Write-Host "Then add that directory to your PATH."
  }
}

function Invoke-KnightcodeInstaller {
  if ([System.Environment]::OSVersion.Platform -ne "Win32NT") {
    Write-Host "This PowerShell installer is for Windows. On Unix, use: curl -fsSL https://knightcode.dev/install.sh | sh"
    exit 1
  }

  $preflightOutput = Invoke-PreflightChecks
  $preflightStatus = $script:KnightcodePreflightStatus

  Write-InstallerTitle
  if ($script:KnightcodePreflightStatus -eq 0) {
    Write-OutputLines $preflightOutput
  }

  $installNode = $false
  if ($script:KnightcodePreflightStatus -ne 0) {
    $installNode = Read-NodeNpmInstallChoice
  }

  if ($installNode) {
    Write-Host ""
    Install-NodeStandalone
    Write-Host ""
  }

  if ($preflightStatus -ne 0) {
    $preflightOutput = Invoke-PreflightChecks
    Write-OutputLines $preflightOutput
    if ($script:KnightcodePreflightStatus -ne 0) {
      exit $script:KnightcodePreflightStatus
    }
  }

  $existingKnightcode = Get-Command $KnightcodeCmd -ErrorAction SilentlyContinue
  if ($existingKnightcode) {
    $env:KNIGHTCODE_EXISTING_PATH = $existingKnightcode.Source
  } else {
    $env:KNIGHTCODE_EXISTING_PATH = ""
  }

  if (Test-KnightcodeManagedInstallEnabled) {
    $managedInstallDir = Select-KnightcodeManagedInstallDir $env:KNIGHTCODE_EXISTING_PATH
    $env:KNIGHTCODE_MANAGED_INSTALL_DIR = $managedInstallDir
    $env:KNIGHTCODE_MANAGED_AGENT_DIR = Split-Path $managedInstallDir -Parent
    $env:KNIGHTCODE_MANAGED_BIN_DIR = Join-Path $env:KNIGHTCODE_MANAGED_AGENT_DIR "bin"
    $env:KNIGHTCODE_NPM_INSTALL_PREFIX = ""
  } else {
    $installPrefix = Select-NpmInstallPrefix
    if ($installPrefix) {
      $env:KNIGHTCODE_NPM_INSTALL_PREFIX = $installPrefix
    } else {
      $env:KNIGHTCODE_NPM_INSTALL_PREFIX = ""
    }
  }

  $env:KNIGHTCODE_LEGACY_NPM_MIGRATION = ""
  if ((Test-KnightcodeManagedInstallEnabled) -and (Get-KnightcodeManagedInstallRootForCommand $env:KNIGHTCODE_EXISTING_PATH)) {
    $env:KNIGHTCODE_NPM_UNINSTALL_PREFIX = ""
  } else {
    $uninstallPrefix = Select-NpmUninstallPrefix $env:KNIGHTCODE_EXISTING_PATH
    if ($uninstallPrefix) {
      $env:KNIGHTCODE_NPM_UNINSTALL_PREFIX = $uninstallPrefix
    } else {
      $env:KNIGHTCODE_NPM_UNINSTALL_PREFIX = ""
    }
    if ((Test-KnightcodeManagedInstallEnabled) -and $env:KNIGHTCODE_EXISTING_PATH -and (Test-NpmPackageInstalledForUninstall)) {
      $env:KNIGHTCODE_LEGACY_NPM_MIGRATION = "1"
    }
  }

  $action = Choose-KnightcodeAction $env:KNIGHTCODE_EXISTING_PATH
  $env:KNIGHTCODE_INSTALL_ACTION = $action
  if ($action -eq "uninstall") {
    Uninstall-KnightcodePackage
    Write-Host ""
    Write-Host "KnightCode was uninstalled successfully."
    exit 0
  }
  if ($action -eq "none") {
    exit 0
  }
  if ($action -eq "migrate") {
    Assert-KnightcodeLegacyNpmInstallRemovable
  }

  $existingBash = Find-ExistingBashForKnightcode
  if (-not $existingBash) {
    $gitBashInstallMethod = Read-GitBashInstallChoice
    if ($gitBashInstallMethod -eq "portable") {
      Write-Host ""
      Install-GitBashStandalone
      Write-Host ""
    } elseif ($gitBashInstallMethod -eq "winget") {
      Write-Host ""
      Install-GitBashWithWinget
      Write-Host ""
    }
  }

  Install-KnightcodePackage
  Remove-BlockedKnightcodePowerShellShim
  Write-Host ""
  if ($action -eq "migrate") {
    Write-Host "KnightCode was migrated to a managed installation successfully."
  } elseif ($action -eq "reinstall") {
    Write-Host "KnightCode was reinstalled successfully."
  } else {
    Write-Host "KnightCode was installed successfully."
  }
  if (Test-KnightcodeManagedInstallEnabled) {
    Write-Host ""
    Write-Host "Update KnightCode later with: knightcode update"
  }

  if (Test-InstalledKnightcodeIsFirstOnPath) {
    Write-Host ""
    Write-Host "Run it with: knightcode"
  } else {
    Write-Host ""
    Write-KnightcodeNotOnPathMessage
  }

  Write-PathRefreshNote
}

Invoke-KnightcodeInstaller
