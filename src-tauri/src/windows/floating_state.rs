use std::{
    fs::{File, OpenOptions},
    io,
    path::{Path, PathBuf},
    sync::Mutex,
};

/// A ready event is just a wake-up: cold mounts and missed events pull the same inbox.
#[derive(Default)]
pub(crate) struct CaptureInbox(Mutex<Vec<PathBuf>>);

impl CaptureInbox {
    pub(crate) fn stage(
        &self,
        source: &Path,
        dest: PathBuf,
        open: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut source = File::open(source).map_err(|e| e.to_string())?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
            .map_err(|e| e.to_string())?;
        let copied = io::copy(&mut source, &mut file);
        drop(file);
        drop(source);
        if let Err(error) = copied.map_err(|e| e.to_string()).and_then(|_| open()) {
            let _ = std::fs::remove_file(dest);
            return Err(error);
        }
        self.0.lock().unwrap_or_else(|e| e.into_inner()).push(dest);
        Ok(())
    }

    pub(crate) fn take(&self) -> Vec<PathBuf> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

impl Drop for CaptureInbox {
    fn drop(&mut self) {
        for path in self.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// All values are physical pixels in the virtual desktop, including work-area origin.
/// Keep the whole window on the capture monitor (not necessarily the primary monitor).
pub(crate) fn compact_bounds(
    area: (i32, i32, u32, u32),
    scale: f64,
    cursor: (f64, f64),
) -> (i32, i32, u32, u32) {
    let (left, top, width, height) = area;
    let side = (480. * scale).round() as u32;
    let w = side.min(width);
    let h = side.min(height);
    let offset = 12. * scale;
    let x = (cursor.0 + offset)
        .round()
        .clamp(left as f64, left as f64 + (width - w) as f64);
    let y = (cursor.1 + offset)
        .round()
        .clamp(top as f64, top as f64 + (height - h) as f64);
    (x as i32, y as i32, w, h)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn fit_near_pointer_respects_negative_origin_taskbar_and_scaled_edges() {
        assert_eq!(
            compact_bounds((-1920, 40, 1920, 1040), 1.5, (-5.0, 1078.0)),
            (-720, 360, 720, 720)
        );
        assert_eq!(
            compact_bounds((100, -600, 320, 200), 2.0, (100.0, -600.0)),
            (100, -600, 320, 200)
        );
    }

    #[test]
    fn failed_open_removes_only_the_unpublished_copy() {
        let root =
            std::env::temp_dir().join(format!("kivio-floating-failure-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("original.png");
        let dest = root.join("pending.png");
        fs::write(&source, b"original").unwrap();
        let inbox = CaptureInbox::default();
        assert!(inbox
            .stage(&source, dest.clone(), || Err("cannot open".into()))
            .is_err());
        assert!(!dest.exists());
        assert!(inbox.take().is_empty());
        assert!(source.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cold_and_repeated_crops_outlive_lens_and_drain_in_order() {
        let root = std::env::temp_dir().join(format!("kivio-floating-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let inbox = CaptureInbox::default();
        for (name, bytes) in [("a.png", b"first".as_slice()), ("b.png", b"second")] {
            let lens = root.join("lens.png");
            fs::write(&lens, bytes).unwrap();
            inbox.stage(&lens, root.join(name), || Ok(())).unwrap();
            fs::remove_file(lens).unwrap();
        }
        let paths = inbox.take();
        assert_eq!(paths, [root.join("a.png"), root.join("b.png")]);
        assert_eq!(fs::read(&paths[0]).unwrap(), b"first");
        assert_eq!(fs::read(&paths[1]).unwrap(), b"second");
        assert!(inbox.take().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
