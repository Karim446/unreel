import SwiftUI
import WebKit

struct SettingsView: View {
    @EnvironmentObject private var settings: FilterSettings
    @Environment(\.dismiss) private var dismiss
    var openEditProfile: () -> Void
    var resetCache: () -> Void
    @State private var confirmReset = false
    @State private var relayCopyStatus = ""

    // Strict mode: limits and filters can only be changed after a wait.
    @State private var unlocked = true
    @State private var checkedLock = false
    @State private var unlockCountdown = 0
    private let unlockDelay = 30
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    /// Copies the Instagram cookies the relay's bridge asks for, as JSON.
    private func copyRelayLogin() {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            let wanted = ["sessionid", "csrftoken", "ds_user_id", "mid", "ig_did", "rur", "datr"]
            var values: [String: String] = [:]
            for c in cookies where c.domain.contains("instagram.com") && wanted.contains(c.name) {
                values[c.name] = c.value
            }
            let data = (try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])) ?? Data()
            UIPasteboard.general.string = String(data: data, encoding: .utf8)
            let message = values["sessionid"] == nil
                ? "Not logged in: open Instagram in Unreel first."
                : "Copied. Paste it only into your own relay."
            Task { @MainActor in relayCopyStatus = message }
        }
    }

    init(openEditProfile: @escaping () -> Void = {}, resetCache: @escaping () -> Void = {}) {
        self.openEditProfile = openEditProfile
        self.resetCache = resetCache
    }

    var body: some View {
        NavigationStack {
            Form {
                usageSection
                lockSection
                limitSections
                filterSections
                otherSections
            }
            .confirmationDialog("Reset cache?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Reset Cache", role: .destructive) {
                    dismiss()
                    resetCache()
                }
            } message: {
                Text("Unreel will reload. You'll stay logged in.")
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear {
                // Decide once, when Filters opens, whether it starts locked.
                guard !checkedLock else { return }
                checkedLock = true
                unlocked = !(settings.strictMode && settings.limitsOn)
            }
            .onReceive(ticker) { _ in
                guard unlockCountdown > 0 else { return }
                unlockCountdown -= 1
                if unlockCountdown == 0 { unlocked = true }
            }
        }
    }

    // MARK: Today

    @ViewBuilder private var usageSection: some View {
        if settings.limitsOn {
            Section {
                LabeledContent("Today", value: UsageSummary.today())
            } footer: {
                Text("Time spent browsing (not in Messages), sessions started, and times you opened the app.")
            }
        }
    }

    // MARK: Strict mode lock

    @ViewBuilder private var lockSection: some View {
        if !unlocked {
            Section {
                Button(unlockCountdown > 0 ? "Unlocking in \(unlockCountdown) s" : "Unlock Filters") {
                    if unlockCountdown == 0 { unlockCountdown = unlockDelay }
                }
                .disabled(unlockCountdown > 0)
            } footer: {
                Text("Strict mode is on. Limits and filters unlock after a \(unlockDelay)-second wait, so they can't be loosened on impulse. Keep this screen open while it counts down.")
            }
        }
    }

    // MARK: Limits

    @ViewBuilder private var limitSections: some View {
        Section {
            Toggle("Limit browsing", isOn: $settings.limitsOn)
            if settings.limitsOn {
                Picker("Daily time", selection: $settings.dailyMinutes) {
                    ForEach(FilterSettings.dailyChoices, id: \.self) { minutes in
                        Text(minutes == 0 ? "No cap" : "\(minutes) min").tag(minutes)
                    }
                }
                Picker("Session length", selection: $settings.sessionMinutes) {
                    ForEach(FilterSettings.sessionChoices, id: \.self) { minutes in
                        Text("\(minutes) min").tag(minutes)
                    }
                }
                Picker("Break between sessions", selection: $settings.breakMinutes) {
                    ForEach(FilterSettings.breakChoices, id: \.self) { minutes in
                        Text(minutes == 0 ? "None" : "\(minutes) min").tag(minutes)
                    }
                }
                Picker("Pause before browsing", selection: $settings.pauseSeconds) {
                    ForEach(FilterSettings.pauseChoices, id: \.self) { seconds in
                        Text(seconds == 0 ? "None" : "\(seconds) s").tag(seconds)
                    }
                }
            }
        } header: {
            Text("Limits")
        } footer: {
            Text("Messages are always open and never counted. Everything else (feed, search, profiles, stories) only opens in a timed session that you start on purpose. The pause gets longer with each session in a day. Posts, reels and stories that friends send you in a chat are free.")
        }
        .disabled(!unlocked)

        if settings.limitsOn {
            Section {
                Toggle("Quiet hours", isOn: $settings.quietHours)
                if settings.quietHours {
                    Picker("From", selection: $settings.quietFrom) {
                        ForEach(0..<24, id: \.self) { hour in
                            Text(FilterSettings.hourLabel(hour)).tag(hour)
                        }
                    }
                    Picker("Until", selection: $settings.quietTo) {
                        ForEach(0..<24, id: \.self) { hour in
                            Text(FilterSettings.hourLabel(hour)).tag(hour)
                        }
                    }
                }
                Toggle("Messages only", isOn: $settings.messagesOnly)
            } footer: {
                Text("During quiet hours only Messages work. Messages only switches browsing off completely until you turn it back on.")
            }
            .disabled(!unlocked)

            Section {
                Toggle("Show session timer", isOn: $settings.timerBar)
                Toggle("Fade color as time runs out", isOn: $settings.fadeColor)
                Toggle("Strict mode", isOn: $settings.strictMode)
            } footer: {
                Text("The timer is a thin bar at the top that drains during a session and turns red for the last 30 seconds. Fading drains the color from photos and videos through the second half of your daily time. Strict mode makes this screen wait 30 seconds before limits or filters can be changed.")
            }
            .disabled(!unlocked)
        }
    }

    // MARK: Filters

    @ViewBuilder private var filterSections: some View {
        Section {
            Toggle("Block the Reels tab", isOn: $settings.blockReelsTab)
            Toggle("Block Reels in the feed", isOn: $settings.blockFeedReels)
            Toggle("Allow Reels sent in DMs", isOn: $settings.allowDMReels)
                .disabled(!settings.blockReelsTab)
        } header: {
            Text("Reels")
        } footer: {
            Text(settings.blockReelsTab
                 ? "With the Reels tab blocked, Reels only play when opened from a DM, one at a time; swiping to another sends you back to the chat. Blocking Reels in the feed hides every video post on the home feed."
                 : "The Reels tab is back and works normally. Blocking Reels in the feed still hides every video post on the home feed.")
        }
        .disabled(!unlocked)

        Section {
            Toggle("Home shows the Following feed", isOn: $settings.followingFeed)
            Toggle("Open to Messages", isOn: $settings.startInMessages)
        } footer: {
            Text("The Following feed has only posts from accounts you follow, newest first, with no suggested posts, and it ends when you've seen everything new. Open to Messages starts the app in your inbox every time instead of where you left off.")
        }
        .disabled(!unlocked)

        Section {
            Toggle("Hide the Explore grid", isOn: $settings.hideExploreGrid)
            Toggle("Hide ads", isOn: $settings.hideAds)
            Toggle("Hide my online status", isOn: $settings.hideOnline)
            Toggle("Hide when I'm typing", isOn: $settings.hideTyping)
        } footer: {
            Text("Search still works with the Explore grid hidden. Hiding ads removes sponsored posts from the feed and skips sponsored Stories. Hiding your online status stops sending Active now, and hiding typing stops the typing indicator from showing to others. You still see theirs.")
        }
        .disabled(!unlocked)
    }

    // MARK: Everything else

    @ViewBuilder private var otherSections: some View {
        Section {
            NavigationLink("App Icon") { AppIconPicker() }
            NavigationLink("Bio Fonts") {
                FancyTextView {
                    dismiss()
                    openEditProfile()
                }
            }
        } header: {
            Text("Extras")
        } footer: {
            Text("Peek: long-press a chat in your inbox to read it without sending Seen. Long-press a profile picture or caption to view it full size or copy the text. Save to Photos is in the ⋯ menu of posts, reels and stories.")
        }
        Section {
            Button("Copy Login for Relay Server") { copyRelayLogin() }
            if !relayCopyStatus.isEmpty {
                Text(relayCopyStatus).font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Notification relay")
        } footer: {
            Text("Only needed if your server says the Instagram login needs attention: this copies your Instagram session so you can log the relay back in. Treat it like a password and paste it only into your own server.")
        }
        Section {
            Button("Reset Cache", role: .destructive) { confirmReset = true }
        } footer: {
            Text("Fixes most display problems: clears saved pages, images and layout data and reloads. You stay logged in, and today's browsing time is kept.")
        }
        Section {
            NavigationLink("Set up Instagram redirect") { SetupGuideView() }
        } footer: {
            Text("To get back here, shake your phone or long-press the app icon and choose Filters.")
        }
        Section {
            LabeledContent("Build", value: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?")
        } footer: {
            Text("Matches the run number on GitHub Actions, so you can confirm which version is installed.")
        }
    }
}
