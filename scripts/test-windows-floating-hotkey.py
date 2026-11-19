"""Exercise the installed application's global hotkey on a disposable Windows desktop.

Run on an interactive Windows test runner, not a user's active desktop.
The caller starts Kivio with --from-autostart (tray only) and passes its PID.
"""
import ctypes as c
from ctypes import wintypes as w
import sys
import time

if sys.platform != 'win32':
    raise SystemExit('This check requires an interactive Windows test runner.')

user = c.WinDLL('user32', use_last_error=True)
CALLBACK = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
user.EnumWindows.argtypes = [CALLBACK, w.LPARAM]
user.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
user.GetWindowRect.argtypes = [w.HWND, c.POINTER(w.RECT)]
user.GetDpiForWindow.argtypes = [w.HWND]
user.IsWindowVisible.argtypes = [w.HWND]
user.SetProcessDpiAwarenessContext.argtypes = [w.HANDLE]
user.SetProcessDpiAwarenessContext(w.HANDLE(-4))  # per-monitor v2
pid = int(sys.argv[1])


def surfaces():
    windows = {}

    @CALLBACK
    def visit(hwnd, unused):
        owner = w.DWORD()
        user.GetWindowThreadProcessId(hwnd, c.byref(owner))
        if owner.value == pid and user.IsWindowVisible(hwnd):
            rect = w.RECT()
            if user.GetWindowRect(hwnd, c.byref(rect)):
                scale = (user.GetDpiForWindow(hwnd) or 96) / 96
                size = (round((rect.right-rect.left)/scale), round((rect.bottom-rect.top)/scale))
                if min(size) > 120:
                    windows[hwnd] = size
        return True

    user.EnumWindows(visit, 0)
    return windows


def wait_for(visible, expected=None):
    deadline = time.monotonic() + 20
    stable = None
    seen = {}
    while time.monotonic() < deadline:
        seen = surfaces()
        if len(seen) > 1 or any(max(size) > 565 for size in seen.values()):
            raise AssertionError(f'Main or oversized window surfaced: {seen}')
        if bool(seen) == visible:
            if expected is not None and expected not in seen:
                raise AssertionError(f'Expected retained small window {expected}, got {seen}')
            if stable is None:
                stable = time.monotonic()
            if time.monotonic() - stable > 1:
                print('Visible Kivio windows (HWND: size in DIP):', seen, flush=True)
                return next(iter(seen), None)
        else:
            stable = None
        time.sleep(0.012)
    raise AssertionError(f'Timed out waiting for visible={visible}: {seen}')


def shortcut():
    # Send the default global chord through Windows, never call the app's toggle IPC.
    keys = (0x11, 0x10, ord('J'))
    for vk in keys:
        user.keybd_event(vk, 0, 0, 0)
    for vk in reversed(keys):
        user.keybd_event(vk, 0, 2, 0)


wait_for(False)
shortcut()
first = wait_for(True)
shortcut()
wait_for(False)
shortcut()
wait_for(True, expected=first)
