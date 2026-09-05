# Browser media compatibility

Interlude 0.2 registers 19 media platforms in a Chromium Manifest V3 extension. The shared adapter controls standard HTML `video` and `audio` elements using their public `pause()` and `play()` methods. Chrome, Edge and Brave use the same extension code on Windows and macOS. This is a compatibility target, not a claim that every platform, browser, subscription, regional catalog or advertisement has passed a live test. Safari, Firefox and native entertainment apps are outside this extension's scope.

The source of truth is [`extension/platforms.js`](../extension/platforms.js). Every entry exports an id, display name, exact hosts, match patterns, `supportTier: 'standard-media-adapter'` and `liveVerified: false`. The manifest registry test rejects accidental permission drift. No wildcard subdomains or `<all_urls>` permission are used.

## Registered platforms

All entries below have automated adapter/allowlist coverage. Live site end-to-end status remains **unverified** unless a separately recorded smoke test identifies the browser, OS, account context, page type and exact steps. Provider documentation establishes the official web surface; it does not establish Interlude playback support. Sources were checked on 2026-09-05.

| Platform id | Explicit registered hosts | Public web surface / provider reference |
| --- | --- | --- |
| `youtube` | `www.youtube.com`, `youtube.com`, `m.youtube.com`, `music.youtube.com` | [YouTube](https://www.youtube.com/), [YouTube Music](https://music.youtube.com/googleplaymusic). Includes normal watch pages and Shorts; feed ownership behavior is fixture tested. |
| `instagram` | `www.instagram.com`, `instagram.com` | [Instagram](https://www.instagram.com/). Feed, Reels and standard media elements are adapter targets. |
| `facebook` | `www.facebook.com`, `facebook.com`, `m.facebook.com`, `web.facebook.com` | [Facebook](https://www.facebook.com/). Feed, Reels and standard video/audio are adapter targets. |
| `tiktok` | `www.tiktok.com`, `tiktok.com` | [TikTok](https://www.tiktok.com/). Mounted feed players are covered by generic ownership tests. |
| `x` | `x.com`, `www.x.com`, `twitter.com`, `www.twitter.com`, `mobile.twitter.com` | [X web help](https://help.x.com/en/using-x/x-issues). Twitter aliases are retained for redirects and existing tabs. |
| `reddit` | `www.reddit.com`, `reddit.com`, `old.reddit.com`, `new.reddit.com` | [Reddit](https://www.reddit.com/). Third-party embedded players require their own registered host permission. |
| `twitch` | `www.twitch.tv`, `twitch.tv`, `player.twitch.tv` | [Twitch embed documentation](https://dev.twitch.tv/docs/embed/video-and-clips/). Public standard media only; no Twitch SDK dependency. |
| `vimeo` | `vimeo.com`, `www.vimeo.com`, `player.vimeo.com` | [Vimeo player documentation](https://developer.vimeo.com/player/sdk/basics). Public standard media only; no Vimeo SDK dependency. |
| `netflix` | `www.netflix.com`, `netflix.com` | [Netflix on a computer](https://help.netflix.com/en/node/23931). Account, plan and protected-playback requirements still apply. |
| `prime-video` | `www.primevideo.com`, `primevideo.com` | [Prime Video browser requirements](https://www.primevideo.com/help/?language=en_US&nodeId=GUX9FYHU5D8LC9EJ). Amazon retail domains and their regional video routes are not registered. Open the Prime Video web player. |
| `disney-plus` | `www.disneyplus.com`, `disneyplus.com` | [Disney+ navigation](https://help.disneyplus.com/es-EC/article/disneyplus-es-ec-navigate-app). Regional availability applies. |
| `hulu` | `www.hulu.com`, `hulu.com` | [Hulu supported computers](https://help.hulu.com/article/hulu-supported-computers). Browser and regional requirements apply. |
| `max` | `www.hbomax.com`, `hbomax.com`, `play.hbomax.com`, `www.max.com`, `max.com`, `play.max.com` | [HBO Max browser troubleshooting](https://help.hbomax.com/tv-en/Answer/Detail/000002521), [Max web support](https://help.max.com/cw-en/Answer/Detail/000002521). Current and legacy public playback hosts are registered. |
| `apple-tv` | `tv.apple.com` | [Apple TV web player](https://tv.apple.com/). Native Apple TV app playback is outside scope. |
| `peacock` | `www.peacocktv.com`, `peacocktv.com` | [Peacock web access](https://www.peacocktv.com/help/article/how-do-i-get-peacock). Regional availability applies. |
| `paramount-plus` | `www.paramountplus.com`, `paramountplus.com` | [Paramount+ sign-in](https://www.paramountplus.com/account/signin/). Regional availability applies. |
| `spotify` | `open.spotify.com` | [Spotify web player help](https://support.spotify.com/nz/article/web-player-help/). HTML audio is supported by the adapter; Web Audio or protected/closed player implementations may be inaccessible. |
| `apple-music` | `music.apple.com` | [Apple Music web guide](https://support.apple.com/en-euro/guide/music-web/welcome/web). No private MusicKit or account APIs are used. |
| `soundcloud` | `soundcloud.com`, `www.soundcloud.com` | [SoundCloud technical requirements](https://help.soundcloud.com/hc/en-us/articles/115003564308-Technical-requirements). Zero-size HTML audio players are included in ownership tests. |

## Permissions and tab selection

The existing `www.youtube.com` access remains a default permission so existing pairing continues to work. All other registered hosts are optional. Clicking **Use this tab** requests only that tab's exact host and any registered embedded-player hosts currently mounted in it. The browser presents the permission prompt. After permission is granted, Interlude injects the adapter into existing permitted frames immediately and registers it at document start for future visits. If a site loads a different registered embedded host later, choose **Use this tab** again to grant that additional host.

`tabs` is used to show the user's open registered media tabs and to select the configured tab, not whichever tab happens to be active. `scripting` installs the adapter after explicit site access. `webNavigation` enumerates frames so a single successful frame cannot conceal a failed embedded player. `storage` holds the local pairing token and session selection; `alarms` allows reconnecting the local companion. The token is restricted to trusted extension contexts. No browsing history or media contents are sent to a remote service.

Selection is distinct from readiness. A selected social feed containing only text remains selected, with `mediaReady: false`. That distinction allows the companion to request a pause even before a feed creates its next autoplaying player. The selected platform and title are shown separately from player readiness. A tab that leaves the registry or closes loses selection.

## Playback behavior

- **Pause** stops all discovered playing video/audio, including offscreen players and muted previews. It holds future autoplay in the selected tab using media events, document mutations and a periodic guard. The guard persists across page navigation and reload within registered, permitted sites.
- **Resume** releases the guard. When enabled, it resumes only an exact player Interlude previously paused: same element, same source, same page and still the primary visible video. Audio elements need not have a visible layout. User-paused media, muted previews, changed sources, newly navigated content and replacement DOM players are never automatically claimed.
- **Manual play while held** is paused again and relinquishes ownership of that player. Use the visible **Release playback** button or begin a new break to release the guard first.
- **Release** removes the guard and forgets ownership without starting playback. The popup and an in-page control both expose it. Disarm/disconnect release the guard. The in-page control remains available when the local companion is offline.
- **Learn** requires a successful pause before bringing up the local companion. **Break** restores a minimized browser and selects the configured tab while preserving a maximized window. No native-app keyboard shortcut is used by the extension, so the adapter is shared across Windows and macOS.
- **Cancellation** aborts stale handoffs, restores the pause guard and prevents a delayed `play()` promise from starting media after cancellation or timeout. Cancelling a pause or learning handoff preserves any still-valid ownership already captured by its pause, so a rapid new prompt can resume that exact player on the next break. Cancellation itself never starts playback; cancelled breaks and explicit release still forget ownership. Missing responses, failed frame acknowledgments, rejected autoplay and timeouts are reported as failures with recovery guidance.

## Embedded and protected players

Standard media in the document, open shadow DOM and accessible same-origin iframe documents is discovered. Registered cross-origin frames with permission answer pause/status individually. Their guards are released on break, but automatic resume is disabled for child frames because a child cannot reliably determine whether its parent iframe has scrolled out of view. Click Play in the embedded player to continue. Top-level player pages, including `player.vimeo.com` and `player.twitch.tv`, use normal ownership rules.

A visible inaccessible iframe on an unregistered host prevents a full pause confirmation. This conservative check can also include a visible non-media embed; Interlude reports that limitation instead of assuming it is silent. A registered iframe without permission similarly reports a failed acknowledgment. Chrome's tab-audio flag is checked after pausing so inaccessible Web Audio, closed shadow roots or other hidden audio cannot be silently reported as paused when Chrome reports the tab as audible. This flag is not a decoder-level proof of all possible proprietary playback states.

Interlude does not bypass DRM, inspect private site internals, unlock subscriptions, read media keys, alter regional availability or promise control of closed/proprietary player implementations. A site that exposes no controllable standard player will show no ready media, or a failed pause if it remains audible. Pause that player manually when prompted. A browser policy may also require a user click before playback resumes. Protected streaming and music sites require live account-based smoke tests before their registry entries can be promoted to verified support.

## Verification

Run `node --test --test-isolation=none tests/browser.test.mjs tests/extension-background.test.mjs` for adapter and background regression coverage. Tests exercise actual extension JavaScript in isolated VM harnesses, including selected/readiness separation, navigation, source ownership, multiple feed players, zero-size audio, muted previews, autoplay holding, cancellation, reconnect-related state, optional permissions and frame/audio failure handling. These tests do not claim real platform playback verification. Browser fixture tests can validate extension-to-companion wiring with local media, but likewise do not substitute for a real signed-in platform smoke test.

A live support record should include browser/version, OS, platform URL/page type, logged-in or logged-out state, initial playback state, pause acknowledgment, real silence, guard behavior on feed scroll/navigation, resume preference, fullscreen behavior, disarm/release and any site-specific limitation. Only update `liveVerified` after that record exists.
