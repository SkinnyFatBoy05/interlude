import Foundation
import AppKit
import ApplicationServices

// AppKit activation and public Accessibility APIs only. No AppleScript, keystrokes, or permission prompts.
struct Output: Encodable {
    var focused = false
    var focusedWindowMaximized = false
    var targetFound = false
    var targetCount = 0
    var attentionRequested = false
    var maximizeStatus = "not_requested"
    var code: String
    var message: String
    var accessibilityTrusted: Bool? = nil
    var targetBundleId: String? = nil
}

func emit(_ result: Output) {
    if let data = try? JSONEncoder().encode(result), let json = String(data: data, encoding: .utf8) {
        print(json)
    }
}

func validBundleID(_ identifier: String) -> Bool {
    identifier.utf8.count <= 255 && identifier.range(of: #"^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$"#, options: .regularExpression) != nil
}

func validatedApplication(_ app: NSRunningApplication, explicitID: String?) -> Bool {
    guard !app.isTerminated, app.activationPolicy == .regular,
          let identifier = app.bundleIdentifier, validBundleID(identifier),
          let url = app.bundleURL, url.pathExtension.lowercased() == "app",
          let bundle = Bundle(url: url), bundle.bundleIdentifier == identifier,
          bundle.object(forInfoDictionaryKey: "CFBundlePackageType") as? String == "APPL",
          let runningExecutable = app.executableURL, let bundleExecutable = bundle.executableURL,
          runningExecutable.resolvingSymlinksInPath() == bundleExecutable.resolvingSymlinksInPath() else { return false }
    if let explicitID = explicitID { return identifier == explicitID }
    let names = [bundle.object(forInfoDictionaryKey: "CFBundleName") as? String,
                 bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String]
    return app.localizedName?.caseInsensitiveCompare("Codex") == .orderedSame
        && names.contains(where: { $0?.caseInsensitiveCompare("Codex") == .orderedSame })
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func settable(_ element: AXUIElement, _ name: String) -> Bool {
    var value = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(element, name as CFString, &value) == .success && value.boolValue
}

func windowRect(_ window: AXUIElement) -> CGRect? {
    guard let position = attribute(window, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
          let size = attribute(window, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var dimensions = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
          AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { return nil }
    return CGRect(origin: point, size: dimensions)
}

func desktopWindows(_ pid: pid_t) -> [[String: Any]] {
    guard let entries = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
    return entries.filter {
        guard ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let bounds = $0[kCGWindowBounds as String] as? [String: Any],
              let width = bounds["Width"] as? NSNumber,
              let height = bounds["Height"] as? NSNumber else { return false }
        return width.doubleValue > 1 && height.doubleValue > 1
    }
}

func accessibleWindows(_ app: AXUIElement) -> [AXUIElement]? {
    var count: CFIndex = 0
    guard AXUIElementGetAttributeValueCount(app, kAXWindowsAttribute as CFString, &count) == .success,
          count >= 0, count <= 128,
          let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement] else { return nil }
    return windows.filter { (attribute($0, kAXSubroleAttribute) as? String) == kAXStandardWindowSubrole }
}

func usableFrame(for rect: CGRect) -> CGRect? {
    let screens = NSScreen.screens
    guard let primaryTop = screens.first?.frame.maxY else { return nil }
    // AppKit has a bottom-left origin; AX uses top-left global display coordinates.
    func axFrame(_ frame: CGRect) -> CGRect {
        CGRect(x: frame.minX, y: primaryTop - frame.maxY, width: frame.width, height: frame.height)
    }
    let screen = screens.max { left, right in
        let leftIntersection = axFrame(left.frame).intersection(rect)
        let rightIntersection = axFrame(right.frame).intersection(rect)
        let leftArea = leftIntersection.isNull ? 0 : leftIntersection.width * leftIntersection.height
        let rightArea = rightIntersection.isNull ? 0 : rightIntersection.width * rightIntersection.height
        return leftArea < rightArea
    }
    return screen.map { axFrame($0.visibleFrame) }
}

func approximatelyEqual(_ a: CGRect, _ b: CGRect) -> Bool {
    abs(a.minX - b.minX) <= 3 && abs(a.minY - b.minY) <= 3
        && abs(a.width - b.width) <= 3 && abs(a.height - b.height) <= 3
}

func maximize(_ window: AXUIElement) -> String {
    guard let original = windowRect(window), let frame = usableFrame(for: original),
          frame.width > 0, frame.height > 0,
          settable(window, kAXPositionAttribute), settable(window, kAXSizeAttribute) else { return "unavailable" }
    var point = frame.origin
    var size = frame.size
    guard let position = AXValueCreate(.cgPoint, &point), let dimensions = AXValueCreate(.cgSize, &size) else { return "unavailable" }
    guard AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, position) == .success,
          AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, dimensions) == .success else { return "unavailable" }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
    guard let actual = windowRect(window), approximatelyEqual(actual, frame) else { return "unavailable" }
    return "maximized"
}

func main() -> Int32 {
    let args = Array(CommandLine.arguments.dropFirst())
    guard args.count == 2, ["yes", "no", "status", "smoke"].contains(args[0]),
          args[1] == "-" || validBundleID(args[1]) else {
        emit(Output(code: "invalid_arguments", message: "Use yes, no, status, or smoke followed by a bundle identifier or -."))
        return 2
    }
    if args[0] == "smoke" {
        // Exercises linked Swift/AppKit runtime without an interactive session or a permission request.
        guard validBundleID("com.example.Codex"), !validBundleID("bad\nidentifier"),
              approximatelyEqual(CGRect(x: 0, y: 0, width: 10, height: 10), CGRect(x: 1, y: 1, width: 10, height: 10)),
              !approximatelyEqual(CGRect.zero, CGRect(x: 10, y: 0, width: 1, height: 1)) else { return 3 }
        emit(Output(code: "smoke_ok", message: "macOS helper runtime is ready; no desktop changes were requested."))
        return 0
    }
    let mode = args[0]
    let explicitID: String? = args[1] == "-" ? nil : args[1]
    let apps = NSWorkspace.shared.runningApplications.filter { validatedApplication($0, explicitID: explicitID) }
    var result = Output(code: "no_target", message: explicitID == nil
        ? "Open Codex first. If its installed name differs, set INTERLUDE_CODEX_BUNDLE_ID to its verified bundle identifier."
        : "No running application matches the configured Codex bundle identifier. Open Codex or check the identifier.")
    result.accessibilityTrusted = AXIsProcessTrusted()
    result.targetFound = !apps.isEmpty
    result.targetCount = apps.count
    guard apps.count == 1 else {
        if apps.count > 1 {
            result.code = "ambiguous_target"
            result.message = "More than one Codex application matches. Return to your task manually or configure its exact bundle identifier."
        }
        emit(result)
        return 0
    }
    let target = apps[0]
    result.targetBundleId = target.bundleIdentifier
    let axApp = AXUIElementCreateApplication(target.processIdentifier)
    _ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.15)
    let trusted = result.accessibilityTrusted == true
    let windows = trusted ? accessibleWindows(axApp) : nil
    let count = windows?.count ?? desktopWindows(target.processIdentifier).count
    result.targetCount = count
    guard count == 1 else {
        result.code = count == 0 ? "no_window" : "ambiguous_target"
        result.message = count == 0
            ? "Codex is running, but no task window could be verified. Open a Codex window from the Dock."
            : "More than one Codex window is open. Return to the intended task manually."
        emit(result)
        return 0
    }
    if mode != "status" {
        _ = target.unhide()
        if let window = windows?.first, settable(window, kAXMinimizedAttribute) {
            _ = AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
        }
        // The OS decides whether a background activation request may take focus.
        _ = target.activate(options: [.activateAllWindows])
        for _ in 0..<5 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            if NSWorkspace.shared.frontmostApplication?.processIdentifier == target.processIdentifier { break }
        }
        if mode == "yes" {
            if !trusted { result.maximizeStatus = "accessibility_required" }
            else if let window = windows?.first { result.maximizeStatus = maximize(window) }
            else { result.maximizeStatus = "unavailable" }
        }
    }
    let visibleWindow = desktopWindows(target.processIdentifier).contains {
        ($0[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true
    }
    result.focused = !target.isTerminated && visibleWindow
        && NSWorkspace.shared.frontmostApplication?.processIdentifier == target.processIdentifier
    if let window = windows?.first, let actual = windowRect(window), let expected = usableFrame(for: actual) {
        result.focusedWindowMaximized = result.focused && approximatelyEqual(actual, expected)
    }
    if result.focused {
        result.code = "focused"
        result.message = result.maximizeStatus == "accessibility_required"
            ? "Codex is in front. To resize it automatically, grant Accessibility access to the Interlude helper in System Settings > Privacy & Security > Accessibility."
            : result.maximizeStatus == "unavailable" ? "Codex is in front, but its window could not be resized." : "Codex is in front."
    } else {
        result.code = mode == "status" ? "not_foreground" : "activation_denied"
        result.message = mode == "status" ? "Codex is not the foreground window."
            : "macOS kept your current window in front. Click Codex in the Dock or use Command-Tab to return."
    }
    emit(result)
    return 0
}

exit(main())
