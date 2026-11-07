# Unreel DM notification diagnostic: expose existing local test and show observer status.
# Run in repository root with PowerShell. No Instagram credentials are read or exported.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Read-Text([string]$path) {
    if (-not [IO.File]::Exists($path)) { throw "Missing $path - run from repository root." }
    $original = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    return @{ value = $original.Replace("`r`n", "`n"); crlf = $original.Contains("`r`n") }
}
function Swap-ExactlyOne([string]$source, [string]$before, [string]$after, [string]$path) {
    $index = $source.IndexOf($before, [StringComparison]::Ordinal)
    if ($index -lt 0) { throw "Expected code missing in $path. Nothing written." }
    if ($source.IndexOf($before, $index + $before.Length, [StringComparison]::Ordinal) -ge 0) {
        throw "More than one match in $path. Nothing written."
    }
    return $source.Substring(0, $index) + $after + $source.Substring($index + $before.Length)
}

$settingsPath = 'Unreel/SettingsView.swift'
$notifierPath = 'Unreel/MessageNotifier.swift'
$settings = Read-Text $settingsPath
$notifier = Read-Text $notifierPath

if ($settings.value.Contains('Button("Test Local Notification")')) { throw 'Diagnostic test already appears installed. Nothing written.' }
$settings.value = Swap-ExactlyOne $settings.value `
    '                    Button("Test Inbox Check") { Task { await notifier.testCheck() } }' `
    "                    Button(`"Test Local Notification`") { notifier.sendTest() }`n                    Button(`"Test Inbox Check`") { Task { await notifier.testCheck() } }" `
    $settingsPath

$before = '        guard let previous, count > previous else { return }'
$after = @'
        guard let previous else {
            status = "DM observer connected: initial unread count \(count); waiting for an increase"
            return
        }
        guard count > previous else {
            status = "DM observer: unread count \(previous) -> \(count); no increase"
            return
        }
'@
$notifier.value = Swap-ExactlyOne $notifier.value $before $after $notifierPath

# Both replacements validated before writing either file.
$utf8 = New-Object Text.UTF8Encoding($false)
foreach ($record in @(@{ path = $settingsPath; data = $settings }, @{ path = $notifierPath; data = $notifier })) {
    $value = $record.data.value
    if ($record.data.crlf) { $value = $value.Replace("`n", "`r`n") }
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($record.path), $value, $utf8)
    Write-Host "Updated $($record.path)"
}
Write-Host 'Diagnostic installed. Review git diff --check before committing.'
