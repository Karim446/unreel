# Unreel: observe Instagram's real bottom-nav DM indicator (not the legacy API).
# Works with the current public repository and the previous diagnostic scripts.
# This does NOT provide notifications after iOS suspends or terminates Unreel.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Read-Source([string]$path) {
    if (-not [IO.File]::Exists($path)) { throw "Missing $path. Run from the repository root." }
    $original = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    return @{ Text = $original.Replace("`r`n", "`n"); CRLF = $original.Contains("`r`n") }
}
function Replace-Once([string]$source, [string]$before, [string]$after, [string]$path) {
    $pos = $source.IndexOf($before, [StringComparison]::Ordinal)
    if ($pos -lt 0) { throw "Expected anchor missing in $path; no files changed. Please share the relevant source." }
    if ($source.IndexOf($before, $pos + $before.Length, [StringComparison]::Ordinal) -ge 0) {
        throw "Anchor is ambiguous in $path; no files changed."
    }
    return $source.Substring(0, $pos) + $after + $source.Substring($pos + $before.Length)
}

$js = 'Unreel/Resources/filter.js'
$web = 'Unreel/WebViewStore.swift'
$notifier = 'Unreel/MessageNotifier.swift'
$settings = 'Unreel/SettingsView.swift'
$paths = @($js, $web, $notifier, $settings)
$files = @{}
foreach ($p in $paths) { $files[$p] = Read-Source $p }
if ($files[$web].Text.Contains('name: "siteDmBadge"')) { throw 'Site DM badge observer already installed; no files changed.' }

# Detect the site's own message badge in its live (normally invisible) tab bar.
# Fallback to Unreel's displayed tab, since sometimes Instagram removes its bar.
# No new HTTP requests, no cookie copying, and no WebSocket frame decoding.
$jsBlock = @'
  // ---- Live DM signal from Instagram's own bottom navigation -----------------
  // This is separate from Unreel's .unreel-badge (which requires a broken API).
  // We only treat a stable clear -> red transition as a NEW alert, not a count.
  let siteBadgeCandidate = null;
  let siteBadgeReported = null;
  let siteBadgeTimer = null;
  function looksRedBadgeColor(css) {
    const rgb = String(css || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (rgb) return +rgb[1] > 165 && +rgb[2] < 135 && +rgb[3] < 155;
    const hex = String(css || '').match(/^#([0-9a-f]{6})$/i);
    return !!hex && parseInt(hex[1].slice(0, 2), 16) > 165 &&
      parseInt(hex[1].slice(2, 4), 16) < 135 && parseInt(hex[1].slice(4, 6), 16) < 155;
  }
  function dmLinkHasBadge(link) {
    if (!link) return false;
    if (/\bunread\b|\bnew messages?\b/i.test(link.getAttribute('aria-label') || '')) return true;
    for (const el of link.querySelectorAll('span, div, circle, rect, path')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.width > 42 || r.height > 42) continue;
      const label = el.getAttribute('aria-label') || '';
      if (/\bunread\b|\bnew messages?\b/i.test(label)) return true;
      if (!el.querySelector('svg') && /^\s*\d{1,3}\+?\s*$/.test(el.textContent || '')) return true;
      const css = getComputedStyle(el);
      if (looksRedBadgeColor(css.backgroundColor) || looksRedBadgeColor(css.fill) ||
          looksRedBadgeColor(el.getAttribute('fill'))) return true;
    }
    return false;
  }
  function inspectSiteDmBadge() {
    const siteNav = findSiteNav();
    const original = siteNav && siteNav.querySelector('a[href^="/direct"]');
    const copied = document.querySelector('#unreel-tabbar a[href^="/direct"]');
    if (!original && !copied) return;  // No usable baseline yet; don't assume clear.
    const detected = dmLinkHasBadge(original) || dmLinkHasBadge(copied);
    if (detected === siteBadgeCandidate) return;
    siteBadgeCandidate = detected;
    clearTimeout(siteBadgeTimer);
    siteBadgeTimer = setTimeout(() => {
      if (siteBadgeCandidate !== detected || siteBadgeReported === detected) return;
      siteBadgeReported = detected;
      try { window.webkit?.messageHandlers?.siteDmBadge?.postMessage(detected); } catch (_) {}
    }, 450);
  }

'@
$files[$js].Text = Replace-Once $files[$js].Text '  const onInbox = () =>' ($jsBlock + "`n" + '  const onInbox = () =>') $js
$before = @'
    // Keep the tab bar in step with the page in the same frame (no flicker).
    updateTabBar();
'@
$after = @'
    // Keep the tab bar in step with the page in the same frame (no flicker).
    updateTabBar();
    inspectSiteDmBadge();
'@
$files[$js].Text = Replace-Once $files[$js].Text $before $after $js

# Route a dedicated website-badge message into Swift; keep old unread handler intact.
$files[$web].Text = Replace-Once $files[$web].Text `
    '        webView.configuration.userContentController.add(self, name: "unread")' `
    "        webView.configuration.userContentController.add(self, name: `"unread`")`n        webView.configuration.userContentController.add(self, name: `"siteDmBadge`")" `
    $web
$webHandler = @'
        if message.name == "siteDmBadge", let present = message.body as? Bool {
            MessageNotifier.shared.observeSiteDmBadge(present)
            return
        }
'@
$files[$web].Text = Replace-Once $files[$web].Text `
    '        if message.name == "unread", let count = message.body as? Int {' `
    ($webHandler + "`n" + '        if message.name == "unread", let count = message.body as? Int {') `
    $web

# Alert on a clear -> red native badge transition, not an unread-count API result.
$swiftBlock = @'
    @Published var siteDmBadgeStatus = "Waiting for Instagram's website DM indicator"
    private var previousSiteDmBadge: Bool?

    func observeSiteDmBadge(_ present: Bool) {
        let previous = previousSiteDmBadge
        previousSiteDmBadge = present
        siteDmBadgeStatus = "Instagram website badge: " + (present ? "red" : "clear")
        // Initial value is only a baseline, not a new DM. Red -> red is not a new event.
        guard previous == false && present else { return }
        guard defaults.object(forKey: "notifications") as? Bool ?? true else {
            siteDmBadgeStatus = "New red badge, but DM alerts are disabled in Filters"
            return
        }
        Task {
            let center = UNUserNotificationCenter.current()
            do {
                let permitted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
                guard permitted else {
                    siteDmBadgeStatus = "Enable Unreel notifications in iPhone Settings"
                    return
                }
                let content = UNMutableNotificationContent()
                content.title = "Instagram"
                content.body = "You have a new unread DM."
                content.sound = .default
                content.userInfo = ["openInbox": true]
                let request = UNNotificationRequest(
                    identifier: "unreel-unread-site-\(UUID().uuidString)",
                    content: content, trigger: nil
                )
                try await center.add(request)
                siteDmBadgeStatus = "Website badge clear -> red; local alert queued"
            } catch {
                siteDmBadgeStatus = "Website badge alert failed: " + error.localizedDescription
            }
        }
    }

'@
$files[$notifier].Text = Replace-Once $files[$notifier].Text `
    '    func updateClaim(_ value: String)' `
    ($swiftBlock + "`n" + '    func updateClaim(_ value: String)') `
    $notifier

# Show persistent signal state independently of the old inbox-test status.
$settingsBlock = @'
                    Text(notifier.siteDmBadgeStatus)
                        .font(.footnote).foregroundStyle(.secondary).textSelection(.enabled)
'@
$files[$settings].Text = Replace-Once $files[$settings].Text `
    '                    Button("Test Inbox Check") { Task { await notifier.testCheck() } }' `
    ($settingsBlock + "`n" + '                    Button("Test Inbox Check") { Task { await notifier.testCheck() } }') `
    $settings

# All anchors must match before any file is written. Retain each original line-ending style.
$utf8 = New-Object Text.UTF8Encoding($false)
foreach ($p in $paths) {
    $out = $files[$p].Text
    if ($files[$p].CRLF) { $out = $out.Replace("`n", "`r`n") }
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($p), $out, $utf8)
    Write-Host "Updated $p"
}
Write-Host 'Observer installed. Review git diff --check and the four changed files before committing.'
