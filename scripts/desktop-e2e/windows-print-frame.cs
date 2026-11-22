using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Windows 11 can host PrintDialog in an Explorer frame while a separate modal
// proxy is the only HWND directly owned by the application that requested printing.
public static class PioraPrintFrame {
    private delegate bool Visit(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Visit callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, Visit callback, IntPtr data);
    [DllImport("user32.dll")] private static extern IntPtr GetLastActivePopup(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int length);

    private static int ProcessId(IntPtr window) {
        int pid;
        GetWindowThreadProcessId(window, out pid);
        return pid;
    }

    private static string WindowClass(IntPtr window) {
        var name = new StringBuilder(128);
        GetClassName(window, name, name.Capacity);
        return name.ToString();
    }

    public static long[] FrameHandles(bool visibleOnly) {
        var frames = new List<long>();
        EnumWindows((w, _) => {
            if ((!visibleOnly || IsWindowVisible(w)) && WindowClass(w) == "ApplicationFrameWindow") frames.Add(w.ToInt64());
            return true;
        }, IntPtr.Zero);
        return frames.ToArray();
    }

    public static long[] VisibleProxies() {
        var proxies = new List<long>();
        EnumWindows((w, _) => {
            if (IsWindowVisible(w) && WindowClass(w) == "ProxyModalWindow") proxies.Add(w.ToInt64());
            return true;
        }, IntPtr.Zero);
        return proxies.ToArray();
    }

    private static bool IsImage(int pid, string expectedPath) {
        try {
            using (var process = Process.GetProcessById(pid))
                return String.Equals(process.MainModule.FileName, expectedPath, StringComparison.OrdinalIgnoreCase);
        } catch (System.ComponentModel.Win32Exception) { return false; }
          catch (InvalidOperationException) { return false; }
          catch (ArgumentException) { return false; }
    }

    private static bool HasFixtureProxy(int browserProcess, int shellProcess, long[] previousProxies) {
        bool expected = false, another = false;
        EnumWindows((w, _) => {
            if (!IsWindowVisible(w) || WindowClass(w) != "ProxyModalWindow" || ProcessId(w) != shellProcess ||
                Array.IndexOf(previousProxies, w.ToInt64()) >= 0) return true;
            var owner = GetWindow(w, 4);
            var popup = GetLastActivePopup(owner);
            // Some Windows builds keep an application-owned Win32 print dialog
            // as the active popup while Explorer hosts the visible print UI.
            bool active = popup == w || (ProcessId(popup) == browserProcess &&
                WindowClass(popup) == "#32770" && GetWindow(popup, 4) == owner && IsWindowVisible(popup));
            if (ProcessId(owner) == browserProcess && WindowClass(owner) == "Chrome_WidgetWin_1" &&
                !IsWindowEnabled(owner) && active) expected = true;
            else another = true;
            return !another;
        }, IntPtr.Zero);
        return expected && !another;
    }

    private static bool ContainsBroker(IntPtr frame, int host, string printBroker) {
        bool found = false;
        EnumChildWindows(frame, (child, _) => {
            var pid = ProcessId(child);
            found = pid != host && IsImage(pid, printBroker);
            return !found;
        }, IntPtr.Zero);
        return found;
    }

    // Report only window/process metadata, never titles or page content. This
    // helps distinguish an unsupported Windows broker layout from an app error.
    public static string Describe(int browserProcess, long[] previousProxies) {
        string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        string explorer = Path.Combine(windows, "explorer.exe");
        string printBroker = Path.Combine(windows, @"SystemApps\Windows.PrintDialog_cw5n1h2txyewy\PrintDialog.exe");
        var rows = new List<string>();
        EnumWindows((w, _) => {
            if (!IsWindowVisible(w)) return true;
            string kind = WindowClass(w);
            int pid = ProcessId(w);
            if (kind != "ApplicationFrameWindow" && kind != "ProxyModalWindow" && pid != browserProcess) return true;
            var owner = GetWindow(w, 4);
            rows.Add(String.Format("class={0},pid={1},ownerPid={2},enabled={3},explorer={4},fixtureProxy={5},printBroker={6},existingProxy={7},ownerPopup={8}",
                kind, pid, ProcessId(owner), IsWindowEnabled(w), IsImage(pid, explorer),
                HasFixtureProxy(browserProcess, pid, previousProxies), ContainsBroker(w, pid, printBroker),
                Array.IndexOf(previousProxies, w.ToInt64()) >= 0, owner != IntPtr.Zero && GetLastActivePopup(owner) == w));
            return true;
        }, IntPtr.Zero);
        return String.Join("; ", rows.ToArray());
    }

    public static IntPtr Find(int browserProcess, long[] previousFrames, long[] previousProxies) {
        string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        string explorer = Path.Combine(windows, "explorer.exe");
        string printBroker = Path.Combine(windows, @"SystemApps\Windows.PrintDialog_cw5n1h2txyewy\PrintDialog.exe");
        IntPtr candidate = IntPtr.Zero;
        foreach (long handle in FrameHandles(true)) {
            if (Array.IndexOf(previousFrames, handle) >= 0) continue;
            var frame = new IntPtr(handle);
            int host = ProcessId(frame);
            if (!IsImage(host, explorer) || !HasFixtureProxy(browserProcess, host, previousProxies) ||
                !ContainsBroker(frame, host, printBroker)) continue;
            // A second broker frame could belong to another print request. A user
            // switching foreground windows must never redirect the fixture's input.
            if (candidate != IntPtr.Zero) return IntPtr.Zero;
            candidate = frame;
        }
        return candidate;
    }
}
