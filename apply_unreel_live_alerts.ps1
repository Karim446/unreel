# Apply Unreel live unread DM alerts without depending on fragile Git patch line contexts.
# Run from the root of the Unreel repository on Windows PowerShell.
# Requires unchanged anchor statements in the four app files.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Read-Source([string]$path) {
    if (-not [System.IO.File]::Exists($path)) { throw "Cannot find $path. Run this script from the repository root." }
    $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    return @{ Text = $raw.Replace("`r`n", "`n"); CrLf = $raw.Contains("`r`n") }
}
function Replace-One([string]$text, [string]$old, [string]$new, [string]$what) {
    $at = $text.IndexOf($old, [System.StringComparison]::Ordinal)
    if ($at -lt 0) { throw "Missing expected code in ${what}. Nothing has been written; stop and share this error." }
    $again = $text.IndexOf($old, $at + $old.Length, [System.StringComparison]::Ordinal)
    if ($again -ge 0) { throw "Ambiguous code match in ${what}. Nothing has been written; stop and share this error." }
    return $text.Substring(0, $at) + $new + $text.Substring($at + $old.Length)
}

$paths = @(
    'Unreel/Resources/filter.js',
    'Unreel/WebViewStore.swift',
    'Unreel/MessageNotifier.swift',
    'Unreel/SettingsView.swift'
)
$data = @{}
foreach ($p in $paths) { $data[$p] = Read-Source $p }

# 1. Ensure filter.js emits an initial unread-count baseline, including zero.
$p = 'Unreel/Resources/filter.js'
$s = $data[$p].Text
if ($s.Contains('let hasUnreadBaseline = false;')) { throw 'This change appears to be already installed in filter.js. Nothing has been written.' }
$s = Replace-One $s '  let unreadCount = 0;' "  let unreadCount = 0;`n  // Send the first successful count, even zero, so Swift can establish a baseline.`n  let hasUnreadBaseline = false;" $p
$s = Replace-One $s '    if (count !== null && count !== unreadCount) {' "    if (count !== null && (!hasUnreadBaseline || count !== unreadCount)) {`n      hasUnreadBaseline = true;" $p
$s = Replace-One $s 'window.webkit?.messageHandlers?.unread?.postMessage(count);   // app icon badge' 'window.webkit?.messageHandlers?.unread?.postMessage(count);   // icon badge and DM notification observer' $p
$data[$p].Text = $s

# 2. Connect the already-registered WKWebView unread message handler to Swift notifications.
$p = 'Unreel/WebViewStore.swift'
$s = $data[$p].Text
$old = @'
        if message.name == "unread", let count = message.body as? Int {
            MessageNotifier.shared.setAppBadge(count)
            return
        }
'@
$new = @'
        if message.name == "unread", let count = message.body as? Int {
            MessageNotifier.shared.setAppBadge(count)
            MessageNotifier.shared.observeLiveUnreadCount(count)
            return
        }
'@
$s = Replace-One $s $old $new $p
$data[$p].Text = $s

# 3. Notify on increases only; launch-time unread counts are just a baseline.
$p = 'Unreel/MessageNotifier.swift'
$s = $data[$p].Text
if ($s.Contains('func observeLiveUnreadCount(')) { throw 'This change appears to be already installed in MessageNotifier.swift. Nothing has been written.' }
$method = @'
    // Live counts come from Unreel's existing Inbox badge observer.
    // They represent unread conversations, not individual DM events.
    private var previousLiveUnread: Int?

    func observeLiveUnreadCount(_ count: Int) {
        guard count >= 0 else { return }
        let previous = previousLiveUnread
        previousLiveUnread = count
        guard let previous, count > previous else { return }
        guard defaults.object(forKey: "notifications") as? Bool ?? true else { return }

        status = "Unread badge increased: \(previous) -> \(count)"
        Task {
            let center = UNUserNotificationCenter.current()
            do {
                let permitted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
                guard permitted else {
                    status = "Enable Unreel notifications in iPhone Settings"
                    return
                }
                let content = UNMutableNotificationContent()
                content.title = "Instagram"
                content.body = "You have new unread DMs."
                content.sound = .default
                content.userInfo = ["openInbox": true]
                let request = UNNotificationRequest(
                    identifier: "unreel-unread-\(UUID().uuidString)",
                    content: content,
                    trigger: nil
                )
                try await center.add(request)
                status = "Local DM alert queued: \(previous) -> \(count)"
            } catch {
                status = "DM alert error: " + error.localizedDescription
            }
        }
    }

'@
$s = Replace-One $s '    // MARK: Turning it on and off' ($method + "`n    // MARK: Turning it on and off") $p
$s = Replace-One $s '        let threadId = response.notification.request.content.userInfo["threadId"] as? String' "        let threadId = response.notification.request.content.userInfo[`"threadId`"] as? String`n        let openInbox = response.notification.request.content.userInfo[`"openInbox`"] as? Bool ?? false" $p
$s = Replace-One $s '            if let threadId { AppRouter.shared.pendingThread = threadId }' "            if let threadId {`n                AppRouter.shared.pendingThread = threadId`n            } else if openInbox {`n                AppRouter.shared.pendingAction = .messages`n            }" $p
$old = @'
        // In the app you're already looking at Instagram, so message notifications
        // stay quiet here; the test one always shows so you can see it works.
        let isTest = notification.request.identifier == "unreel-test"
        completionHandler(isTest ? [.banner, .list, .sound] : [])
'@
$new = @'
        // Display experimental unread alerts while the app is open.
        let show = notification.request.identifier == "unreel-test" ||
                   notification.request.identifier.hasPrefix("unreel-unread-")
        completionHandler(show ? [.banner, .list, .sound] : [])
'@
$s = Replace-One $s $old $new $p
$data[$p].Text = $s

# 4. Expose a toggle in the existing Filters view.
$p = 'Unreel/SettingsView.swift'
$s = $data[$p].Text
$old = @'
                Section {
                    Button("Test Inbox Check") { Task { await notifier.testCheck() } }
'@
$new = @'
                Section {
                    Toggle("Alert on new unread DMs while app is running", isOn: $settings.notifications)
                    Button("Test Inbox Check") { Task { await notifier.testCheck() } }
'@
$s = Replace-One $s $old $new $p
$old = 'Test Inbox Check tries one request and shows Instagram''s answer. Copy Login copies your Instagram session cookies so the relay server can connect as you.'
$new = 'Unread alerts reuse the Inbox badge count and cannot reliably run while Unreel is closed. Test Inbox Check still probes the old failing inbox endpoint. Copy Login copies your Instagram session cookies so the relay server can connect as you.'
$s = Replace-One $s $old $new $p
$data[$p].Text = $s

# Only write after every expected edit has been matched and prepared successfully.
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($p in $paths) {
    $s = $data[$p].Text
    if ($data[$p].CrLf) { $s = $s.Replace("`n", "`r`n") }
    [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($p), $s, $utf8)
    Write-Host "Updated $p"
}
Write-Host 'Done. Run: git diff --check; git diff --stat'
