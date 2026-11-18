//! Compact mode is a placement of the main chat HWND, not a second renderer.
use super::floating_state::{compact_bounds, CaptureInbox};
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

#[cfg(target_os = "windows")]
use ::windows::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{GetWindowPlacement, SetWindowPlacement, WINDOWPLACEMENT},
};

#[derive(Clone, Copy)]
struct NormalPlacement {
    #[cfg(target_os = "windows")]
    placement: WINDOWPLACEMENT,
    #[cfg(not(target_os = "windows"))]
    position: PhysicalPosition<i32>,
    #[cfg(not(target_os = "windows"))]
    size: PhysicalSize<u32>,
    #[cfg(not(target_os = "windows"))]
    maximized: bool,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl NormalPlacement {
    fn read(window: &WebviewWindow) -> Result<Self, String> {
        #[cfg(target_os = "windows")]
        {
            // rcNormalPosition preserves the restore rectangle even when maximized.
            let mut placement = WINDOWPLACEMENT {
                length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                ..Default::default()
            };
            unsafe { GetWindowPlacement(HWND(window.hwnd().map_err(err)?.0), &mut placement) }
                .map_err(err)?;
            Ok(Self { placement })
        }
        #[cfg(not(target_os = "windows"))]
        {
            let maximized = window.is_maximized().map_err(err)?;
            if maximized {
                window.unmaximize().map_err(err)?;
            }
            Ok(Self {
                position: window.outer_position().map_err(err)?,
                size: window.inner_size().map_err(err)?,
                maximized,
            })
        }
    }

    fn restore(self, window: &WebviewWindow) -> Result<(), String> {
        window.set_always_on_top(false).map_err(err)?;
        #[cfg(target_os = "windows")]
        unsafe { SetWindowPlacement(HWND(window.hwnd().map_err(err)?.0), &self.placement) }
            .map_err(err)?;
        #[cfg(not(target_os = "windows"))]
        {
            if window.is_maximized().map_err(err)? {
                window.unmaximize().map_err(err)?;
            }
            window.set_position(self.position).map_err(err)?;
            window.set_size(self.size).map_err(err)?;
            if self.maximized {
                window.maximize().map_err(err)?;
            }
        }
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct FloatingChat {
    pub(crate) inbox: CaptureInbox,
    normal: Mutex<Option<NormalPlacement>>,
    #[cfg(target_os = "windows")]
    hidden_for_lens: Mutex<Option<u64>>,
}

pub(crate) fn is_compact(window: &WebviewWindow) -> bool {
    window.label() == "chat"
        && window.try_state::<FloatingChat>().is_some_and(|state| {
            state
                .normal
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_some()
        })
}

pub(crate) fn forget_window(app: &AppHandle) {
    if let Some(state) = app.try_state::<FloatingChat>() {
        *state.normal.lock().unwrap_or_else(|e| e.into_inner()) = None;
        #[cfg(target_os = "windows")]
        clear_capture_hide(app);
    }
}

#[tauri::command]
pub(crate) fn chat_take_floating_captures(
    window: WebviewWindow,
    state: State<'_, FloatingChat>,
) -> Result<Vec<PathBuf>, String> {
    if window.label() != "chat" {
        return Err("Only the main chat can take captures".into());
    }
    Ok(state.inbox.take())
}

#[tauri::command]
pub(crate) fn chat_set_floating_mode(
    window: WebviewWindow,
    enabled: bool,
    state: State<'_, FloatingChat>,
) -> Result<(), String> {
    if window.label() != "chat" {
        return Err("Only the main chat can change floating mode".into());
    }
    let previous = *state.normal.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(previous) = previous {
        if !enabled {
            *state.normal.lock().unwrap_or_else(|e| e.into_inner()) = None;
            // SetWindowPlacement must be last: applying a minimum size afterwards can
            // unmaximize the HWND again. Keep the snapshot on failure for a retry.
            super::apply_chat_window_min_size(&window, false);
            if let Err(error) = previous.restore(&window) {
                *state.normal.lock().unwrap_or_else(|e| e.into_inner()) = Some(previous);
                return Err(error);
            }
        }
        return Ok(());
    }
    if !enabled {
        return Ok(());
    }
    let cursor = window.cursor_position().map_err(err)?;
    let monitor = window
        .monitor_from_point(cursor.x, cursor.y)
        .map_err(err)?
        .or(window.current_monitor().map_err(err)?)
        .ok_or("No monitor for compact chat")?;
    let work = monitor.work_area();
    let (x, y, width, height) = compact_bounds(
        (
            work.position.x,
            work.position.y,
            work.size.width,
            work.size.height,
        ),
        monitor.scale_factor(),
        (cursor.x, cursor.y),
    );
    let previous = NormalPlacement::read(&window)?;
    let enter = || -> tauri::Result<()> {
        if window.is_maximized()? {
            window.unmaximize()?;
        }
        window.set_min_size(Some(tauri::LogicalSize::new(300., 220.)))?;
        window.set_position(PhysicalPosition::new(x, y))?;
        window.set_size(PhysicalSize::new(width, height))?;
        window.show()?;
        window.set_focus()
    };
    if let Err(error) = enter() {
        super::apply_chat_window_min_size(&window, false);
        previous.restore(&window)?;
        return Err(err(error));
    }
    *state.normal.lock().unwrap_or_else(|e| e.into_inner()) = Some(previous);
    Ok(())
}

// Keep the chat out of BOTH the frozen frame and the live-capture fallback.
// Only restore a window that this Lens opening hid, never a closed/minimized chat.
#[cfg(target_os = "windows")]
pub(crate) fn hide_for_capture(app: &AppHandle, seq: u64) -> Result<(), String> {
    let Some(chat) = app.get_webview_window("chat") else {
        return Ok(());
    };
    if !is_compact(&chat) || !chat.is_visible().map_err(err)? || chat.is_minimized().map_err(err)? {
        return Ok(());
    }
    chat.hide().map_err(err)?;
    *app.state::<FloatingChat>()
        .hidden_for_lens
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(seq);
    // hide() can dispatch to the event loop. Query visibility before waiting for DWM.
    if chat.is_visible().map_err(err)? {
        return Err("Could not hide compact chat for capture".into());
    }
    unsafe { ::windows::Win32::Graphics::Dwm::DwmFlush() }.map_err(err)
}

#[cfg(target_os = "windows")]
pub(crate) fn clear_capture_hide(app: &AppHandle) {
    *app.state::<FloatingChat>()
        .hidden_for_lens
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = None;
}

#[cfg(target_os = "windows")]
pub(crate) fn restore_after_capture(app: &AppHandle, seq: u64) {
    let state = app.state::<FloatingChat>();
    let mut hidden = state
        .hidden_for_lens
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if *hidden != Some(seq) {
        return;
    }
    *hidden = None;
    drop(hidden);
    if let Some(chat) = app.get_webview_window("chat") {
        if !chat.is_visible().unwrap_or(true) {
            // Cancel returns to the app being captured; don't steal focus just to unhide chat.
            use ::windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
            if let Ok(hwnd) = chat.hwnd() {
                unsafe {
                    let _ = ShowWindow(HWND(hwnd.0), SW_SHOWNOACTIVATE);
                }
            }
        }
    }
}
