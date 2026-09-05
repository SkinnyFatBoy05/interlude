using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class FocusCodex
{
    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool FlashWindowEx(ref FlashInfo info);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern int GetPackageFamilyName(IntPtr process, ref uint length, StringBuilder name);

    [StructLayout(LayoutKind.Sequential)]
    private struct FlashInfo { public uint size; public IntPtr window; public uint flags; public uint count; public uint timeout; }

    private static bool IsCodexDesktop(Process process)
    {
        IntPtr handle = OpenProcess(0x1000, false, process.Id);
        if (handle == IntPtr.Zero) return false;
        try
        {
            uint length = 0;
            int status = GetPackageFamilyName(handle, ref length, null);
            if (status == 122 && length > 0 && length <= 1024)
            {
                StringBuilder family = new StringBuilder((int)length);
                // The Store app is ChatGPT.exe; never target ordinary ChatGPT by its name.
                return GetPackageFamilyName(handle, ref length, family) == 0
                    && String.Equals(family.ToString(), "OpenAI.Codex_2p2nqsd0c76g0", StringComparison.OrdinalIgnoreCase);
            }
            // Unpackaged builds must identify themselves as Codex in executable metadata too.
            if (status != 15700 || !String.Equals(process.ProcessName, "Codex", StringComparison.OrdinalIgnoreCase)) return false;
            FileVersionInfo info = process.MainModule.FileVersionInfo;
            return String.Equals(info.ProductName, "Codex", StringComparison.OrdinalIgnoreCase)
                && info.CompanyName != null && info.CompanyName.StartsWith("OpenAI", StringComparison.OrdinalIgnoreCase);
        }
        finally { CloseHandle(handle); }
    }

    private static void Result(string code, string message, IntPtr target, int count, bool attention, string maximizeStatus)
    {
        bool focused = count == 1 && target != IntPtr.Zero && IsWindow(target) && !IsIconic(target) && GetForegroundWindow() == target;
        Console.WriteLine(new JavaScriptSerializer().Serialize(new {
            focused,
            focusedWindowMaximized = focused && IsZoomed(target),
            targetFound = count > 0,
            targetCount = count,
            attentionRequested = attention,
            maximizeStatus,
            code,
            message
        }));
    }

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1 || (args[0] != "yes" && args[0] != "no" && args[0] != "status" && args[0] != "smoke"))
            {
                Result("invalid_arguments", "Use yes, no, status, or smoke.", IntPtr.Zero, 0, false, "not_requested");
                return 2;
            }
            if (args[0] == "smoke")
            {
                Result("smoke_ok", "Windows helper runtime is ready; no desktop changes were requested.", IntPtr.Zero, 0, false, "not_requested");
                return 0;
            }
            var candidates = new HashSet<uint>();
            var processes = new List<Process>(Process.GetProcessesByName("Codex"));
            processes.AddRange(Process.GetProcessesByName("ChatGPT"));
            foreach (Process process in processes)
            {
                using (process)
                {
                    try { if (IsCodexDesktop(process)) candidates.Add((uint)process.Id); }
                    catch { /* Processes can exit or become inaccessible during discovery. */ }
                }
            }
            var targets = new List<IntPtr>();
            // A process can own several windows. MainWindowHandle alone misses that ambiguity.
            EnumWindows(delegate(IntPtr window, IntPtr parameter)
            {
                uint processId;
                GetWindowThreadProcessId(window, out processId);
                if (candidates.Contains(processId) && IsWindowVisible(window) && GetWindow(window, 4) == IntPtr.Zero) targets.Add(window);
                return targets.Count < 10000;
            }, IntPtr.Zero);
            if (targets.Count != 1)
            {
                Result(targets.Count == 0 ? "no_target" : "ambiguous_target",
                    targets.Count == 0 ? "Open the Codex desktop app first." : "More than one Codex window is open. Return to your task manually.",
                    IntPtr.Zero, targets.Count, false, "not_requested");
                return 0;
            }
            IntPtr target = targets[0];
            if (args[0] != "status")
            {
                if (args[0] == "yes") ShowWindowAsync(target, 3);
                else if (IsIconic(target)) ShowWindowAsync(target, 9);
                SetForegroundWindow(target);
                for (int attempt = 0; attempt < 5 && (GetForegroundWindow() != target || IsIconic(target) || (args[0] == "yes" && !IsZoomed(target))); attempt++) Thread.Sleep(100);
            }
            bool focused = IsWindow(target) && !IsIconic(target) && GetForegroundWindow() == target;
            bool attention = !focused && args[0] != "status";
            if (attention)
            {
                var flash = new FlashInfo { size = (uint)Marshal.SizeOf(typeof(FlashInfo)), window = target, flags = 3, count = 3, timeout = 0 };
                FlashWindowEx(ref flash); // Its return value describes the old state, not request success.
            }
            string maximize = args[0] == "yes" ? (IsZoomed(target) ? "maximized" : "unavailable") : "not_requested";
            Result(focused ? "focused" : args[0] == "status" ? "not_foreground" : "activation_denied",
                focused ? (maximize == "unavailable" ? "Codex is in front, but its window could not be maximized." : "Codex is in front.")
                    : args[0] == "status" ? "Codex is not the foreground window."
                    : "Windows kept your current window in front. Taskbar attention was requested; click Codex to return.",
                target, 1, attention, maximize);
            return 0;
        }
        catch
        {
            Result("inspection_failed", "Could not inspect the Codex window. Open it from the taskbar.", IntPtr.Zero, 0, false, "not_requested");
            return 0;
        }
    }
}
