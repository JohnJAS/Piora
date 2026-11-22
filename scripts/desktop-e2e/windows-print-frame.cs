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
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
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

    public static long[] VisibleFrames() {
        var frames = new List<long>();
        EnumWindows((w, _) => {
            if (IsWindowVisible(w) && WindowClass(w) == "ApplicationFrameWindow") frames.Add(w.ToInt64());
            return true;
        }, IntPtr.Zero);
        return frames.ToArray();
    }

    private static bool IsImage(int pid, string expectedPath) {
        try {
            using (var process = Process.GetProcessById(pid))
                return String.Equals(process.MainModule.FileName, expectedPath, StringComparison.OrdinalIgnoreCase);
        } catch (System.ComponentModel.Win32Exception) { return false; }
          catch (InvalidOperationException) { return false; }
          catch (ArgumentException) { return false; }
    }

    public static IntPtr Find(int browserProcess, long[] previousFrames) {
        var frame = GetForegroundWindow();
        if (frame == IntPtr.Zero || WindowClass(frame) != "ApplicationFrameWindow" ||
            Array.IndexOf(previousFrames, frame.ToInt64()) >= 0) return IntPtr.Zero;

        var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var host = ProcessId(frame);
        if (!IsImage(host, Path.Combine(windows, "explorer.exe"))) return IntPtr.Zero;

        bool proxyFound = false;
        EnumWindows((w, _) => {
            if (ProcessId(w) != browserProcess || WindowClass(w) != "Chrome_WidgetWin_1" ||
                !IsWindowVisible(w) || IsWindowEnabled(w)) return true;
            var proxy = GetLastActivePopup(w);
            proxyFound = WindowClass(proxy) == "ProxyModalWindow" && ProcessId(proxy) == host && GetWindow(proxy, 4) == w;
            return !proxyFound;
        }, IntPtr.Zero);
        if (!proxyFound) return IntPtr.Zero;

        string printBroker = Path.Combine(windows, @"SystemApps\Windows.PrintDialog_cw5n1h2txyewy\PrintDialog.exe");
        bool brokerFound = false;
        EnumChildWindows(frame, (child, _) => {
            var pid = ProcessId(child);
            brokerFound = pid != host && IsImage(pid, printBroker);
            return !brokerFound;
        }, IntPtr.Zero);
        return brokerFound ? frame : IntPtr.Zero;
    }
}
