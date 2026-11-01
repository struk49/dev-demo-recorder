use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

// Helper function to generate a unique timestamp string
fn chrono_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Command to initialize recording parameters and resolve output file path.
/// Saves files directly to the user's Videos or Downloads directory for easy File Explorer access.
#[tauri::command]
async fn start_recording(target_window: Option<String>, frame_rate: Option<u32>) -> Result<String, String> {
    let window_title = target_window.unwrap_or_else(|| "Visual Studio Code".to_string());
    let fps = frame_rate.unwrap_or(30);
    println!("Starting screen recording targeting: {} at {} FPS", window_title, fps);

    // Target the user's native Videos directory (or Downloads directory fallback)
    let save_dir = dirs::video_dir()
        .or_else(dirs::download_dir)
        .unwrap_or_else(std::env::temp_dir);

    if !save_dir.exists() {
        let _ = fs::create_dir_all(&save_dir);
    }

    let file_name = format!("dev_demo_{}.webm", chrono_timestamp());
    let output_path = save_dir.join(file_name);

    Ok(output_path.to_string_lossy().into_owned())
}

/// Command to signal screen recording stop
#[tauri::command]
async fn stop_recording() -> Result<(), String> {
    println!("Stopping screen recording...");
    Ok(())
}

/// Command to open the output video file or its parent folder natively in File Explorer / Finder
#[tauri::command]
async fn reveal_recording(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    #[cfg(target_os = "windows")]
    {
        if path_buf.exists() {
            let _ = std::process::Command::new("explorer")
                .arg("/select,")
                .arg(&path)
                .spawn();
        } else if let Some(parent) = path_buf.parent() {
            let _ = std::process::Command::new("explorer")
                .arg(parent)
                .spawn();
        }
    }

    #[cfg(target_os = "macos")]
    {
        if path_buf.exists() {
            let _ = std::process::Command::new("open")
                .arg("-R")
                .arg(&path)
                .spawn();
        } else if let Some(parent) = path_buf.parent() {
            let _ = std::process::Command::new("open")
                .arg(parent)
                .spawn();
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = path_buf.parent() {
            let _ = std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn();
        }
    }

    Ok(())
}

/// Application entrypoint
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            reveal_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}