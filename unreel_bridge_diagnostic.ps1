# Unreel DM bridge diagnostic - runs from the root of the repository.
# Adds a separate web signal status, manual WKWebView bridge test, and badge-poll reporting.
# Does not export account data, change network requests, or trigger fake DM alerts.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Read-Source([string]$path) {
    if (-not [IO.File]::Exists($path)) { throw "Missing $path. Run from the repository root." }
    $raw = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    return @{ Text = $raw.Replace("`r`n", "`n"); CRLF = $raw.Contains("`r`n") }
}
function Replace-One([string]$source, [string]$before, [string]$after, [string]$path) {
    $where = $source.IndexOf($before, [StringComparison]::Ordinal)
    if ($where -lt 0) { throw "Expected code not found in $path. No files changed." }
    if ($source.IndexOf($before, $where + $before.Length, [StringComparison]::Ordinal) -ge 0) {
        throw "Ambiguous code anchor in $path. No files changed."
    }
    return $source.Substring(0, $where) + $after + $source.Substring($where + $before.Length)
}

$js = 'Unreel/Resources/filter.js'
$web = 'Unreel/WebViewStore.swift'
$notifier = 'Unreel/MessageNotifier.swift'
$settings = 'Unreel/SettingsView.swift'
$paths = @($js, $web, $notifier, $settings)
$data = @{}
foreach ($path in $paths) { $data[$path] = Read-Source $path }
if ($data[$web].Text.Contains('name: "unreelDiag"')) { throw 'Bridge diagnostic is already installed; no files changed.' }

# 1. Separate observable status: notification-test status is not overwritten.
$p = $notifier
$data[$p].Text = Replace-One $data[$p].Text `
    '    @Published var status = "Not checked yet"' `
    "    @Published var status = `"Not checked yet`"`n    @Published var bridgeStatus = `"No website signals received yet`"" `
    $p

# 2. Register a distinct diagnostic JS handler and display unread events even if
#    the alert logic does not fire (e.g. initial unread baseline).
$p = $web
$data[$p].Text = Replace-One $data[$p].Text `
    '        webView.configuration.userContentController.add(self, name: "unread")' `
    "        webView.configuration.userContentController.add(self, name: `"unread`")`n        webView.configuration.userContentController.add(self, name: `"unreelDiag`")" `
    $p
$before = @'
        if message.name == "unread", let count = message.body as? Int {
            MessageNotifier.shared.setAppBadge(count)
            MessageNotifier.shared.observeLiveUnreadCount(count)
            return
        }
'@
$after = @'
        if message.name == "unreelDiag", let detail = message.body as? String {
            MessageNotifier.shared.bridgeStatus = detail
            return
        }
        if message.name == "unread", let count = message.body as? Int {
            MessageNotifier.shared.bridgeStatus = "Swift received unread count: \(count)"
            MessageNotifier.shared.setAppBadge(count)
            MessageNotifier.shared.observeLiveUnreadCount(count)
            return
        }
'@
$data[$p].Text = Replace-One $data[$p].Text $before $after $p

# 3. Display the actual bridge state and provide a manual ping that bypasses
#    the Instagram badge-count API entirely.
$p = $settings
$before = '                    Toggle("Alert on new unread DMs while app is running", isOn: $settings.notifications)'
$after = @'
                    Toggle("Alert on new unread DMs while app is running", isOn: $settings.notifications)
                    Text("Website signal: \(notifier.bridgeStatus)")
                        .font(.footnote).foregroundStyle(.secondary).textSelection(.enabled)
                    Button("Test JavaScript Bridge") {
                        guard let view = WebViewStore.current?.webView else {
                            notifier.bridgeStatus = "No active WKWebView instance"
                            return
                        }
                        // Read only our own badge, not the account or messages.
                        view.evaluateJavaScript("window.webkit.messageHandlers.unreelDiag.postMessage('Manual bridge OK; Unreel badge: ' + (document.querySelector('#unreel-tabbar .unreel-badge')?.textContent || 'none'))")
                    }
'@
$data[$p].Text = Replace-One $data[$p].Text $before $after $p

# 4. Report script initialization and whether the badge poll actually returns
#    a usable count. This changes no request URLs, headers or poll frequency.
$p = $js
$data[$p].Text = Replace-One $data[$p].Text `
    '  window.__unreelLoaded = true;' `
    @'
  window.__unreelLoaded = true;
  try { window.webkit?.messageHandlers?.unreelDiag?.postMessage('filter.js injected and running'); } catch (_) {}
'@ `
    $p
$data[$p].Text = Replace-One $data[$p].Text `
    '  let lastBadgeFetch = 0;' `
    @'
  let lastBadgeFetch = 0;
  let lastBadgeDiagnostic = '';
'@ `
    $p
$before = @'
    if (count !== null && (!hasUnreadBaseline || count !== unreadCount)) {
'@
$after = @'
    const badgeDiagnostic = count === null
      ? 'Instagram badge API did not return a numeric count'
      : 'Instagram badge API count: ' + count;
    if (badgeDiagnostic !== lastBadgeDiagnostic) {
      lastBadgeDiagnostic = badgeDiagnostic;
      try { window.webkit?.messageHandlers?.unreelDiag?.postMessage(badgeDiagnostic); } catch (_) {}
    }
    if (count !== null && (!hasUnreadBaseline || count !== unreadCount)) {
'@
$data[$p].Text = Replace-One $data[$p].Text $before $after $p

# All replacements succeeded; only now write files, preserving line endings.
$utf8 = New-Object Text.UTF8Encoding($false)
foreach ($path in $paths) {
    $content = $data[$path].Text
    if ($data[$path].CRLF) { $content = $content.Replace("`n", "`r`n") }
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($path), $content, $utf8)
    Write-Host "Updated $path"
}
Write-Host 'Diagnostic installed. Inspect with git diff --check and git diff before committing.'
