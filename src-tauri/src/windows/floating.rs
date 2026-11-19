//! The quick composer owns one webview. Never navigate or destroy it on toggle:
//! its mounted editor (including unsent attachments) is the draft owner.
use super::floating_state::{compact_bounds, CaptureInbox};
use std::{path::PathBuf, sync::Mutex};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub(crate) const LABEL: &str = "floating-chat";

#[derive(Default)]
pub(crate) struct FloatingChat {
    pub(crate) inbox: CaptureInbox,
    pub(crate) conversation: Mutex<Option<String>>,
    // Only the Lens opening that hid this window may restore it.
    hidden_for_lens: Mutex<Option<(u64, bool)>>,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub(crate) fn toggle_floating_chat_window(app: &AppHandle) -> Result<(), String> {
    let window = if let Some(window) = app.get_webview_window(LABEL) {
        // A toggle during capture dismisses the temporarily hidden composer; don't
        // reveal it over the selection or resurrect it when that capture ends.
        if clear_capture_hide(app) {
            return Ok(());
        }
        if window.is_visible().map_err(err)? && !window.is_minimized().map_err(err)? {
            return window.hide().map_err(err);
        }
        window
    } else {
        let window = WebviewWindowBuilder::new(
            app,
            LABEL,
            WebviewUrl::App("index.html#floating-chat".into()),
        )
        .title("Kivio · Floating Chat")
        .inner_size(480., 480.)
        .min_inner_size(300., 220.)
        .decorations(false)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .build()
        .map_err(err)?;
        // Best effort: unavailable pointer/monitor data shouldn't prevent opening.
        if let Ok(cursor) = window.cursor_position() {
            if let Ok(Some(monitor)) = window.monitor_from_point(cursor.x, cursor.y) {
                let work = monitor.work_area();
                let (x, y, w, h) = compact_bounds(
                    (
                        work.position.x,
                        work.position.y,
                        work.size.width,
                        work.size.height,
                    ),
                    monitor.scale_factor(),
                    (cursor.x, cursor.y),
                );
                let _ = window.set_position(PhysicalPosition::new(x, y));
                let _ = window.set_size(PhysicalSize::new(w, h));
            }
        }
        window
    };
    reveal(&window)
}

pub(crate) fn reveal(window: &WebviewWindow) -> Result<(), String> {
    if window.is_minimized().map_err(err)? {
        window.unminimize().map_err(err)?;
    }
    window.show().map_err(err)?;
    window.set_focus().map_err(err)
}

// Window creation from synchronous IPC can deadlock WebView2. Keep the shortcut
// entry independent of IPC argument extraction and use the same lifecycle for both.
pub(crate) mod ipc {
    #[tauri::command]
    pub(crate) async fn toggle_floating_chat_window(app: tauri::AppHandle) -> Result<(), String> {
        super::toggle_floating_chat_window(&app)
    }
}

#[tauri::command]
pub(crate) fn chat_take_floating_captures(
    window: WebviewWindow,
    state: State<'_, FloatingChat>,
) -> Result<Vec<PathBuf>, String> {
    if window.label() != LABEL {
        return Err("Only floating chat can take these captures".into());
    }
    Ok(state.inbox.take())
}

pub(crate) fn hide_for_capture(
    app: &AppHandle,
    seq: u64,
    return_focus: bool,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    if !window.is_visible().map_err(err)? || window.is_minimized().map_err(err)? {
        return Ok(());
    }
    window.hide().map_err(err)?;
    *app.state::<FloatingChat>()
        .hidden_for_lens
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some((seq, return_focus));
    if window.is_visible().map_err(err)? {
        return Err("Could not hide floating chat for capture".into());
    }
    #[cfg(target_os = "windows")]
    unsafe { ::windows::Win32::Graphics::Dwm::DwmFlush() }.map_err(err)?;
    Ok(())
}

pub(crate) fn clear_capture_hide(app: &AppHandle) -> bool {
    app.state::<FloatingChat>()
        .hidden_for_lens
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .is_some()
}

pub(crate) fn restore_after_capture(app: &AppHandle, seq: u64) {
    let state = app.state::<FloatingChat>();
    let mut hidden = state
        .hidden_for_lens
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some((_, return_focus)) = hidden.filter(|(owner, _)| *owner == seq) else {
        return;
    };
    *hidden = None;
    drop(hidden);
    if let Some(window) = app.get_webview_window(LABEL) {
        if !window.is_visible().unwrap_or(true) {
            if return_focus {
                if let Err(error) = reveal(&window) {
                    eprintln!("[floating-chat] restoring composer: {error}");
                }
                return;
            }
            #[cfg(target_os = "windows")]
            {
                use ::windows::Win32::{
                    Foundation::HWND,
                    UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE},
                };
                if let Ok(hwnd) = window.hwnd() {
                    unsafe {
                        let _ = ShowWindow(HWND(hwnd.0), SW_SHOWNOACTIVATE);
                    }
                }
            }
            #[cfg(not(target_os = "windows"))]
            let _ = window.show();
        }
    }
}
