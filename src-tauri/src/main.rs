#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager, WebviewEvent, DragDropEvent};
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder};
use tauri::command;
use serde::{Serialize, Deserialize};
use serde_json::{json, Value};

// ── PendingOpenFiles: stores files to open from cold start or Opened events ──
#[derive(Default)]
struct PendingOpenFiles(Mutex<Vec<String>>);

#[derive(Default)]
struct CancelledAiStreams(Mutex<HashSet<String>>);

static TERMINAL_COUNTER: AtomicU64 = AtomicU64::new(1);

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

#[derive(Default)]
struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

fn non_empty_env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn user_home_dir() -> Result<PathBuf, String> {
    if let Some(home) = non_empty_env_path("HOME") {
        return Ok(home);
    }

    if let Some(profile) = non_empty_env_path("USERPROFILE") {
        return Ok(profile);
    }

    let drive = std::env::var_os("HOMEDRIVE").filter(|value| !value.is_empty());
    let path = std::env::var_os("HOMEPATH").filter(|value| !value.is_empty());
    if let (Some(drive), Some(path)) = (drive, path) {
        return Ok(PathBuf::from(format!(
            "{}{}",
            drive.to_string_lossy(),
            path.to_string_lossy()
        )));
    }

    Err("无法获取用户主目录（HOME / USERPROFILE 均不可用）".to_string())
}

// ── OpenedDocument: returned by open_markdown_file command ──
#[derive(Serialize)]
struct OpenedDocument {
    path: String,
    file_name: String,
    content: String,
    external: bool,
    readonly: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedMarkdown {
    path: String,
    file_name: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardImage {
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiChatMessageInput {
    role: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiChatRequest {
    stream_id: Option<String>,
    provider_type: String,
    api_url: String,
    credential_ref: Option<String>,
    model: String,
    messages: Vec<AiChatMessageInput>,
    temperature: Option<f64>,
    top_p: Option<f64>,
    max_tokens: Option<u32>,
    enable_thinking: Option<bool>,
    thinking_budget: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiTokenUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiChatResponse {
    content: String,
    reasoning_content: Option<String>,
    model: Option<String>,
    usage: Option<AiTokenUsage>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiChatStreamEvent {
    stream_id: String,
    content_delta: Option<String>,
    reasoning_delta: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
    model: Option<String>,
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: Option<OpenAiChoiceMessage>,
}

#[derive(Deserialize)]
struct OpenAiChoiceMessage {
    content: Option<String>,
    reasoning_content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContentBlock>,
    model: Option<String>,
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    block_type: Option<String>,
    text: Option<String>,
    thinking: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    usage_metadata: Option<GeminiUsage>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
}

#[derive(Deserialize)]
struct GeminiContent {
    parts: Option<Vec<GeminiPart>>,
}

#[derive(Deserialize)]
struct GeminiPart {
    text: Option<String>,
    thought: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiUsage {
    prompt_token_count: Option<u64>,
    candidates_token_count: Option<u64>,
    total_token_count: Option<u64>,
}

#[derive(Deserialize)]
struct OllamaResponse {
    model: Option<String>,
    message: Option<OllamaMessage>,
    response: Option<String>,
    prompt_eval_count: Option<u64>,
    eval_count: Option<u64>,
}

#[derive(Deserialize)]
struct OllamaMessage {
    content: Option<String>,
    thinking: Option<String>,
}

// ── Utility: check if a path is a supported text/code file ──
fn is_openable_text_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_lowercase().as_str(),
                "md"
                    | "markdown"
                    | "mdown"
                    | "mkd"
                    | "txt"
                    | "text"
                    | "yaml"
                    | "yml"
                    | "xml"
                    | "sql"
                    | "py"
                    | "json"
                    | "js"
                    | "jsx"
                    | "ts"
                    | "tsx"
                    | "css"
                    | "scss"
                    | "html"
                    | "htm"
                    | "csv"
                    | "log"
                    | "sh"
                    | "toml"
                    | "ini"
                    | "env"
            )
        })
        .unwrap_or(false)
}

fn is_pdf_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

fn markdown_title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|name| name.to_str())
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .unwrap_or("PDF 转换结果")
        .to_string()
}

fn clean_pdf_page_text(page: &str) -> String {
    let mut lines = Vec::new();
    let mut previous_blank = false;

    for line in page.lines() {
        let trimmed = line.trim_end();
        let is_blank = trimmed.trim().is_empty();
        if is_blank {
            if !previous_blank && !lines.is_empty() {
                lines.push(String::new());
            }
            previous_blank = true;
            continue;
        }
        lines.push(trimmed.to_string());
        previous_blank = false;
    }

    lines.join("\n").trim().to_string()
}

fn pdf_text_to_markdown(path: &Path, text: &str) -> String {
    let title = markdown_title_from_path(path);
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let pages: Vec<String> = normalized
        .split('\u{c}')
        .map(clean_pdf_page_text)
        .filter(|page| !page.trim().is_empty())
        .collect();

    let mut markdown = format!("# {}\n\n", title);
    if pages.len() <= 1 {
        markdown.push_str(pages.first().map(String::as_str).unwrap_or(""));
    } else {
        for (index, page) in pages.iter().enumerate() {
            markdown.push_str(&format!("## 第 {} 页\n\n{}\n\n", index + 1, page));
        }
    }

    markdown.trim_end().to_string()
}

// ── Collect openable text/code file paths from CLI arguments ──
fn collect_openable_text_paths(args: Vec<String>, cwd: Option<PathBuf>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter_map(|arg| {
            let raw_path = PathBuf::from(arg);
            let path = if raw_path.is_absolute() {
                raw_path
            } else if let Some(cwd) = &cwd {
                cwd.join(raw_path)
            } else {
                raw_path
            };
            if path.exists() && path.is_file() && is_openable_text_file(&path) {
                Some(path.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect()
}

// ── Emit opened-files event to frontend ──
fn push_and_emit_open_files(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let state = app.state::<PendingOpenFiles>();
    state.0.lock().unwrap().extend(paths.clone());
    let _ = app.emit("opened-files", &paths);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

// ── Command: frontend calls this on mount to get pending files ──
#[command]
fn take_pending_open_files(app: AppHandle) -> Vec<String> {
    let state = app.state::<PendingOpenFiles>();
    let mut files = state.0.lock().unwrap();
    std::mem::take(&mut *files)
}

// ── Command: exit app from frontend-controlled close behavior ──
#[command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

// ── Command: Rust securely reads a supported text/code file ──
#[command]
fn open_markdown_file(path: String) -> Result<OpenedDocument, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err("文件不存在".to_string());
    }
    if !path_buf.is_file() {
        return Err("目标路径不是文件".to_string());
    }
    if !is_openable_text_file(&path_buf) {
        return Err("不支持的文件类型".to_string());
    }
    let metadata = std::fs::metadata(&path_buf).map_err(|e| e.to_string())?;
    const MAX_FILE_SIZE: u64 = 20 * 1024 * 1024; // 20MB
    if metadata.len() > MAX_FILE_SIZE {
        return Err("文件过大，暂不支持打开超过 20MB 的文本文件".to_string());
    }
    let content = std::fs::read_to_string(&path_buf).map_err(|e| e.to_string())?;
    let file_name = path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md")
        .to_string();
    Ok(OpenedDocument {
        path: path_buf.to_string_lossy().to_string(),
        file_name,
        content,
        external: true,
        readonly: false,
    })
}

#[command]
fn import_pdf_text_as_markdown(path: String) -> Result<ImportedMarkdown, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err("文件不存在".to_string());
    }
    if !path_buf.is_file() {
        return Err("目标路径不是文件".to_string());
    }
    if !is_pdf_file(&path_buf) {
        return Err("当前仅支持文字版 PDF".to_string());
    }

    let metadata = std::fs::metadata(&path_buf).map_err(|e| e.to_string())?;
    const MAX_PDF_SIZE: u64 = 80 * 1024 * 1024;
    if metadata.len() > MAX_PDF_SIZE {
        return Err("PDF 文件过大，暂不支持超过 80MB 的文件".to_string());
    }

    let extracted = pdf_extract::extract_text(&path_buf)
        .map_err(|e| format!("PDF 文本提取失败: {}", e))?;
    if extracted.trim().is_empty() {
        return Err("未检测到可提取文本，这可能是扫描版 PDF。可安装 OCR/视觉插件后再试。".to_string());
    }

    let title = markdown_title_from_path(&path_buf);
    let file_name = format!("{}.md", title);
    Ok(ImportedMarkdown {
        path: path_buf.to_string_lossy().to_string(),
        file_name,
        content: pdf_text_to_markdown(&path_buf, &extracted),
    })
}

// ── DirectoryEntry: returned by read_directory_entries ──
#[derive(Serialize)]
struct DirectoryEntry {
    name: String,
    is_directory: bool,
    is_file: bool,
}

// ── Command: read directory entries (bypasses fs plugin scope) ──
#[command]
fn read_directory_entries(dir_path: String) -> Result<Vec<DirectoryEntry>, String> {
    let path_buf = PathBuf::from(&dir_path);
    if !path_buf.exists() {
        return Err(format!("目录不存在: {}", dir_path));
    }
    if !path_buf.is_dir() {
        return Err(format!("目标路径不是目录: {}", dir_path));
    }
    let entries = std::fs::read_dir(&path_buf)
        .map_err(|e| format!("无法读取目录: {}", e))?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();
        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();
        let is_dir = path.is_dir();
        result.push(DirectoryEntry {
            name,
            is_directory: is_dir,
            is_file: !is_dir,
        });
    }
    Ok(result)
}

// ── Command: read file content (bypasses fs plugin scope) ──
#[command]
fn read_file_content(file_path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&file_path);
    if !path_buf.exists() {
        return Err(format!("文件不存在: {}", file_path));
    }
    if !path_buf.is_file() {
        return Err(format!("目标路径不是文件: {}", file_path));
    }
    std::fs::read_to_string(&path_buf)
        .map_err(|e| format!("读取文件失败: {}", e))
}

// ── Command: write file content (bypasses fs plugin scope) ──
#[command]
fn write_file_content(file_path: String, content: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&file_path);
    if let Some(parent) = path_buf.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&path_buf, &content)
        .map_err(|e| format!("写入文件失败: {}", e))
}

// ── Command: write binary file content ──
#[command]
fn write_binary_file(file_path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&file_path, bytes)
        .map_err(|e| format!("写入文件失败: {}", e))
}

// ── Command: read binary file content ──
#[command]
fn read_binary_file(file_path: String) -> Result<Vec<u8>, String> {
    let path_buf = PathBuf::from(&file_path);
    if !path_buf.exists() {
        return Err(format!("文件不存在: {}", file_path));
    }
    if !path_buf.is_file() {
        return Err(format!("目标路径不是文件: {}", file_path));
    }
    std::fs::read(&path_buf)
        .map_err(|e| format!("读取文件失败: {}", e))
}

// ── Command: create directory and missing parents ──
#[command]
fn create_dir_all(dir_path: String) -> Result<(), String> {
    std::fs::create_dir_all(&dir_path)
        .map_err(|e| format!("创建目录失败: {}", e))
}

// ── Command: copy file and create parent directory if needed ──
#[command]
fn copy_file_content(source_path: String, target_path: String) -> Result<(), String> {
    let target = PathBuf::from(&target_path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::copy(&source_path, &target_path)
        .map(|_| ())
        .map_err(|e| format!("复制文件失败: {}", e))
}

fn unique_clipboard_path(extension: &str) -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "orcha-writer-clipboard-{}-{}.{}",
        std::process::id(),
        millis,
        extension
    ))
}

#[cfg(target_os = "macos")]
fn escape_applescript_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
fn write_pasteboard_class_to_file(class_code: &str, output_path: &Path) -> Result<bool, String> {
    let path = escape_applescript_path(output_path);
    let script = format!(
        r#"set outFile to POSIX file "{}"
try
  set imageData to the clipboard as «class {}»
on error
  return "NO_IMAGE"
end try
set fileRef to open for access outFile with write permission
try
  set eof fileRef to 0
  write imageData to fileRef
  close access fileRef
on error errMsg
  try
    close access fileRef
  end try
  error errMsg
end try
return "OK""#,
        path, class_code
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("读取剪贴板失败: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Ok(stdout.contains("OK"));
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("读取剪贴板失败: {}", stderr.trim()))
}

#[cfg(target_os = "macos")]
fn read_macos_pasteboard_data(data_type: &'static objc2_app_kit::NSPasteboardType) -> Option<Vec<u8>> {
    let pasteboard = objc2_app_kit::NSPasteboard::generalPasteboard();
    pasteboard
        .dataForType(data_type)
        .map(|data| data.to_vec())
        .filter(|bytes| !bytes.is_empty())
}

#[cfg(target_os = "macos")]
fn clipboard_image_from_tiff_bytes(bytes: Vec<u8>) -> Result<Option<ClipboardImage>, String> {
    let tiff_path = unique_clipboard_path("tiff");
    let converted_path = unique_clipboard_path("png");
    std::fs::write(&tiff_path, &bytes)
        .map_err(|e| format!("读取剪贴板图片失败: {}", e))?;

    let converted = convert_image_to_png(&tiff_path, &converted_path).is_ok() && converted_path.exists();
    let result = if converted {
        std::fs::read(&converted_path)
            .map(|data| ("clipboard-image.png".to_string(), "image/png".to_string(), data))
            .map_err(|e| format!("读取剪贴板图片失败: {}", e))
    } else {
        Ok(("clipboard-image.tiff".to_string(), "image/tiff".to_string(), bytes))
    };

    let _ = std::fs::remove_file(&tiff_path);
    let _ = std::fs::remove_file(&converted_path);

    let (file_name, mime_type, bytes) = result?;
    if bytes.is_empty() {
        Ok(None)
    } else {
        Ok(Some(ClipboardImage {
            file_name,
            mime_type,
            bytes,
        }))
    }
}

#[cfg(target_os = "macos")]
fn read_macos_pasteboard_file_urls() -> Vec<String> {
    let pasteboard = objc2_app_kit::NSPasteboard::generalPasteboard();
    let Some(items) = pasteboard.pasteboardItems() else {
        return Vec::new();
    };
    let file_url_type = unsafe { objc2_app_kit::NSPasteboardTypeFileURL };
    let mut urls = Vec::new();

    for item in items.iter() {
        if let Some(value) = item.stringForType(file_url_type) {
            let text = value.to_string();
            if !text.is_empty() {
                urls.push(text);
            }
        }
    }

    urls
}

#[cfg(target_os = "macos")]
fn convert_image_to_png(source_path: &Path, target_path: &Path) -> Result<(), String> {
    let output = Command::new("sips")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg(source_path)
        .arg("--out")
        .arg(target_path)
        .output()
        .map_err(|e| format!("转换剪贴板图片失败: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "转换剪贴板图片失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

// ── Command: read image from macOS pasteboard ──
#[command]
fn read_clipboard_image() -> Result<Option<ClipboardImage>, String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(bytes) = read_macos_pasteboard_data(unsafe { objc2_app_kit::NSPasteboardTypePNG }) {
            return Ok(Some(ClipboardImage {
                file_name: "clipboard-image.png".to_string(),
                mime_type: "image/png".to_string(),
                bytes,
            }));
        }

        if let Some(bytes) = read_macos_pasteboard_data(unsafe { objc2_app_kit::NSPasteboardTypeTIFF }) {
            return clipboard_image_from_tiff_bytes(bytes);
        }

        let png_path = unique_clipboard_path("png");
        if write_pasteboard_class_to_file("PNGf", &png_path)? && png_path.exists() {
            let bytes = std::fs::read(&png_path)
                .map_err(|e| format!("读取剪贴板图片失败: {}", e))?;
            let _ = std::fs::remove_file(&png_path);
            if !bytes.is_empty() {
                return Ok(Some(ClipboardImage {
                    file_name: "clipboard-image.png".to_string(),
                    mime_type: "image/png".to_string(),
                    bytes,
                }));
            }
        }

        let tiff_path = unique_clipboard_path("tiff");
        if write_pasteboard_class_to_file("TIFF", &tiff_path)? && tiff_path.exists() {
            let bytes = std::fs::read(&tiff_path)
                .map_err(|e| format!("读取剪贴板图片失败: {}", e))?;
            let _ = std::fs::remove_file(&tiff_path);
            return clipboard_image_from_tiff_bytes(bytes);
        }

        Ok(None)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}

// ── Command: read file URLs from macOS pasteboard ──
#[command]
fn read_clipboard_file_urls() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(read_macos_pasteboard_file_urls())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

// ── Command: check whether a path exists ──
#[command]
fn path_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

// ── Command: delete file or directory ──
#[command]
fn delete_path(path: String, recursive: bool) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    if path_buf.is_dir() {
        if recursive {
            std::fs::remove_dir_all(&path_buf)
                .map_err(|e| format!("删除目录失败: {}", e))
        } else {
            std::fs::remove_dir(&path_buf)
                .map_err(|e| format!("删除目录失败: {}", e))
        }
    } else {
        std::fs::remove_file(&path_buf)
            .map_err(|e| format!("删除文件失败: {}", e))
    }
}

// ── Command: rename file or directory ──
#[command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to)
        .map_err(|e| format!("重命名失败: {}", e))
}

// ── Command: reveal file or directory in the native file manager ──
#[cfg(any(target_os = "windows", test))]
fn explorer_select_arg(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace("/", "\\");
    format!("/select,\"{}\"", normalized)
}

#[command]
fn reveal_path_in_file_manager(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("路径不存在: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path_buf)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("无法在访达中显示: {}", e))
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .raw_arg(explorer_select_arg(&path_buf))
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("无法在文件资源管理器中显示: {}", e))
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if path_buf.is_dir() {
            path_buf
        } else {
            path_buf
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from(&path))
        };

        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("无法在文件管理器中显示: {}", e))
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        Err("当前平台暂不支持在文件管理器中显示".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explorer_select_arg_quotes_and_normalizes_windows_paths() {
        let arg = explorer_select_arg(Path::new(r"C:\Users/alice/My Docs/note.md"));

        assert_eq!(arg, "/select,\"C:\\Users\\alice\\My Docs\\note.md\"");
    }

    #[test]
    fn explorer_select_arg_preserves_unc_prefix() {
        let arg = explorer_select_arg(Path::new("//server/share/folder/note.md"));

        assert_eq!(arg, "/select,\"\\\\server\\share\\folder\\note.md\"");
    }
}

fn terminal_working_dir(path: Option<String>) -> Result<PathBuf, String> {
    let path_buf = match path {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value),
        _ => user_home_dir()?,
    };

    if path_buf.is_dir() {
        return Ok(path_buf);
    }

    if path_buf.is_file() {
        return path_buf
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法获取文件所在目录".to_string());
    }

    Err(format!("终端路径不存在: {}", path_buf.to_string_lossy()))
}

// ── Command: open a native terminal at the workspace or selected directory ──
#[command]
fn open_terminal_at(path: Option<String>) -> Result<(), String> {
    let dir = terminal_working_dir(path)?;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal"])
            .arg(&dir)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("无法打开终端: {}", e))
    }

    #[cfg(target_os = "windows")]
    {
        match Command::new("wt")
            .arg("-d")
            .arg(&dir)
            .spawn()
        {
            Ok(_) => Ok(()),
            Err(wt_error) => match Command::new("powershell.exe")
                .args(["-NoExit", "-Command", "Set-Location -LiteralPath $args[0]"])
                .arg(&dir)
                .spawn()
            {
                Ok(_) => Ok(()),
                Err(power_shell_error) => Command::new("cmd.exe")
                    .args(["/K", "cd", "/d"])
                    .arg(&dir)
                    .spawn()
                    .map(|_| ())
                    .map_err(|cmd_error| {
                        format!(
                            "无法打开终端: wt: {}; PowerShell: {}; cmd: {}",
                            wt_error, power_shell_error, cmd_error
                        )
                    }),
            },
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let attempts: [(&str, &[&str]); 4] = [
            ("gnome-terminal", &["--working-directory"]),
            ("konsole", &["--workdir"]),
            ("xfce4-terminal", &["--working-directory"]),
            ("x-terminal-emulator", &["--working-directory"]),
        ];
        let mut last_error = None;

        for (program, args) in attempts {
            let result = Command::new(program)
                .args(args)
                .arg(&dir)
                .spawn();
            match result {
                Ok(_) => return Ok(()),
                Err(e) => last_error = Some(e),
            }
        }

        Err(format!(
            "无法打开终端: {}",
            last_error
                .map(|e| e.to_string())
                .unwrap_or_else(|| "未找到可用终端".to_string())
        ))
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        Err("当前平台暂不支持打开终端".to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalCreateResult {
    id: String,
    cwd: String,
    shell: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    id: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    id: String,
    code: Option<u32>,
}

fn next_terminal_id() -> String {
    let counter = TERMINAL_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    format!("terminal-{}-{}", timestamp, counter)
}

fn default_terminal_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Some(comspec) = std::env::var_os("COMSPEC").filter(|value| !value.is_empty()) {
            return comspec.to_string_lossy().to_string();
        }
        "powershell.exe".to_string()
    }

    #[cfg(all(unix, not(target_os = "windows")))]
    {
        if let Some(shell) = std::env::var_os("SHELL").filter(|value| !value.is_empty()) {
            return shell.to_string_lossy().to_string();
        }

        #[cfg(target_os = "macos")]
        {
            "/bin/zsh".to_string()
        }

        #[cfg(not(target_os = "macos"))]
        {
            "/bin/bash".to_string()
        }
    }

    #[cfg(not(any(unix, target_os = "windows")))]
    {
        "sh".to_string()
    }
}

fn push_terminal_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if path.as_os_str().is_empty() || paths.iter().any(|existing| existing == &path) {
        return;
    }
    paths.push(path);
}

fn push_existing_terminal_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if path.is_dir() {
        push_terminal_path(paths, path);
    }
}

fn terminal_path_env() -> Option<OsString> {
    let mut paths = Vec::new();

    #[cfg(target_os = "macos")]
    {
        for path in [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ] {
            push_existing_terminal_path(&mut paths, PathBuf::from(path));
        }
    }

    #[cfg(unix)]
    {
        if let Some(home) = std::env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
        {
            push_existing_terminal_path(&mut paths, home.join(".local").join("bin"));
            push_existing_terminal_path(&mut paths, home.join(".cargo").join("bin"));

            let gem_ruby_dir = home.join(".gem").join("ruby");
            if let Ok(entries) = fs::read_dir(gem_ruby_dir) {
                for entry in entries.flatten() {
                    push_existing_terminal_path(&mut paths, entry.path().join("bin"));
                }
            }
        }
    }

    if let Some(existing) = std::env::var_os("PATH").filter(|value| !value.is_empty()) {
        for path in std::env::split_paths(&existing) {
            push_terminal_path(&mut paths, path);
        }
    }

    if paths.is_empty() {
        None
    } else {
        std::env::join_paths(paths).ok()
    }
}

fn terminal_env_is_utf8(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            let value = value.to_ascii_uppercase();
            value.contains("UTF-8") || value.contains("UTF8")
        })
        .unwrap_or(false)
}

fn configure_terminal_env(command: &mut CommandBuilder, shell: &str, cwd: &Path) {
    command.env("SHELL", shell);
    command.env("PWD", cwd.as_os_str());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "Orcha Writer");

    if let Some(path) = terminal_path_env() {
        command.env("PATH", path);
    }

    if std::env::var_os("LC_ALL").is_some() && !terminal_env_is_utf8("LC_ALL") {
        command.env_remove("LC_ALL");
    }
    if !terminal_env_is_utf8("LC_CTYPE") {
        command.env("LC_CTYPE", "UTF-8");
    }
    if !terminal_env_is_utf8("LANG") {
        command.env("LANG", "en_US.UTF-8");
    }
}

fn terminal_command(shell: &str, cwd: &Path) -> CommandBuilder {
    let mut command = CommandBuilder::new(shell);

    command.cwd(cwd);
    configure_terminal_env(&mut command, shell, cwd);
    command
}

fn terminal_exit_code(status: portable_pty::ExitStatus) -> Option<u32> {
    #[allow(deprecated)]
    Some(status.exit_code())
}

// ── Command: create an embedded PTY terminal session ──
#[command]
fn terminal_create(
    app: AppHandle,
    manager: tauri::State<TerminalManager>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<TerminalCreateResult, String> {
    let dir = terminal_working_dir(cwd)?;
    let shell = default_terminal_shell();
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: rows.max(2),
        cols: cols.max(20),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("创建终端失败: {}", e))?;
    let command = terminal_command(&shell, &dir);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| format!("启动 shell 失败: {}", e))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("读取终端输出失败: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("写入终端失败: {}", e))?;
    drop(pair.slave);

    let id = next_terminal_id();
    let child = Arc::new(Mutex::new(child));
    let writer = Arc::new(Mutex::new(writer));
    let session = TerminalSession {
        master: pair.master,
        child: Arc::clone(&child),
        writer,
    };

    {
        let mut sessions = manager
            .sessions
            .lock()
            .map_err(|_| "终端会话已被锁定".to_string())?;
        sessions.insert(id.clone(), session);
    }

    let sessions = Arc::clone(&manager.sessions);
    let app_handle = app.clone();
    let output_id = id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let _ = app_handle.emit("terminal-output", TerminalOutputEvent {
                        id: output_id.clone(),
                        bytes: buffer[..size].to_vec(),
                    });
                }
                Err(_) => break,
            }
        }

        let code = child
            .lock()
            .ok()
            .and_then(|mut child| child.wait().ok())
            .and_then(terminal_exit_code);

        if let Ok(mut sessions) = sessions.lock() {
            sessions.remove(&output_id);
        }

        let _ = app_handle.emit("terminal-exit", TerminalExitEvent {
            id: output_id,
            code,
        });
    });

    Ok(TerminalCreateResult {
        id,
        cwd: dir.to_string_lossy().to_string(),
        shell,
    })
}

// ── Command: write user input to an embedded terminal ──
#[command]
fn terminal_write(
    manager: tauri::State<TerminalManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    let writer = {
        let sessions = manager
            .sessions
            .lock()
            .map_err(|_| "终端会话已被锁定".to_string())?;
        sessions
            .get(&id)
            .map(|session| Arc::clone(&session.writer))
            .ok_or_else(|| "终端会话不存在".to_string())?
    };

    let mut writer = writer
        .lock()
        .map_err(|_| "终端输入已被锁定".to_string())?;
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|e| format!("写入终端失败: {}", e))
}

// ── Command: resize an embedded terminal PTY ──
#[command]
fn terminal_resize(
    manager: tauri::State<TerminalManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = manager
        .sessions
        .lock()
        .map_err(|_| "终端会话已被锁定".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "终端会话不存在".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("调整终端大小失败: {}", e))
}

// ── Command: kill an embedded terminal session ──
#[command]
fn terminal_kill(manager: tauri::State<TerminalManager>, id: String) -> Result<(), String> {
    let session = {
        let mut sessions = manager
            .sessions
            .lock()
            .map_err(|_| "终端会话已被锁定".to_string())?;
        sessions.remove(&id)
    };

    if let Some(session) = session {
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
        }
    }

    Ok(())
}

fn resolve_ai_credential(credential_ref: Option<&str>) -> Result<Option<String>, String> {
    let value = credential_ref.unwrap_or("").trim();
    if value.is_empty() {
        return Ok(None);
    }

    if let Some(name) = value.strip_prefix("env:") {
        let env_name = name.trim();
        if env_name.is_empty() {
            return Err("环境变量凭据名称为空".to_string());
        }
        return std::env::var(env_name)
            .map(Some)
            .map_err(|_| format!("未读取到环境变量 {}", env_name));
    }

    if value.starts_with("secret:") {
        return Err("secret 凭据读取尚未接入，请先使用 env:环境变量名 或临时填入 API Key".to_string());
    }

    Ok(Some(value.to_string()))
}

fn require_ai_credential(credential: Option<String>, provider_name: &str) -> Result<String, String> {
    credential.ok_or_else(|| format!("{} 凭据未配置", provider_name))
}

fn append_chat_completions_endpoint(api_url: &str) -> String {
    let trimmed = api_url.trim().trim_end_matches('/');
    if trimmed.to_ascii_lowercase().ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{}/chat/completions", trimmed)
    }
}

fn ai_request_endpoint(provider_type: &str, api_url: &str) -> Result<String, String> {
    let trimmed = api_url.trim();
    if trimmed.is_empty() {
        return Err("模型供应商请求地址未配置".to_string());
    }

    if provider_type == "openai-compatible" {
        return Ok(append_chat_completions_endpoint(trimmed));
    }

    Ok(trimmed.to_string())
}

fn request_messages(messages: &[AiChatMessageInput]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| json!({
            "role": message.role,
            "content": message.content,
        }))
        .collect()
}

fn openai_like_request_body(request: &AiChatRequest, stream: bool) -> Value {
    let mut body = json!({
        "model": request.model,
        "messages": request_messages(&request.messages),
        "stream": stream,
    });

    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(top_p) = request.top_p {
        body["top_p"] = json!(top_p);
    }
    if let Some(max_tokens) = request.max_tokens {
        body["max_tokens"] = json!(max_tokens);
    }
    if let Some(enable_thinking) = request.enable_thinking {
        body["enable_thinking"] = json!(enable_thinking);
    }
    if let Some(thinking_budget) = request.thinking_budget {
        body["thinking_budget"] = json!(thinking_budget);
    }

    body
}

fn parse_openai_response(response_text: &str) -> Result<AiChatResponse, String> {
    let parsed: OpenAiChatResponse = serde_json::from_str(response_text)
        .map_err(|e| format!("解析 AI 响应失败: {}", e))?;
    let content = parsed
        .choices
        .first()
        .and_then(|choice| choice.message.as_ref())
        .and_then(|message| message.content.clone())
        .unwrap_or_default()
        .trim()
        .to_string();
    let reasoning_content = parsed
        .choices
        .first()
        .and_then(|choice| choice.message.as_ref())
        .and_then(|message| message.reasoning_content.clone())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());

    if content.is_empty() && reasoning_content.is_none() {
        return Err("AI 返回了空结果".to_string());
    }

    Ok(AiChatResponse {
        content,
        reasoning_content,
        model: parsed.model,
        usage: parsed.usage.map(|usage| AiTokenUsage {
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
        }),
    })
}

fn parse_anthropic_response(response_text: &str) -> Result<AiChatResponse, String> {
    let parsed: AnthropicResponse = serde_json::from_str(response_text)
        .map_err(|e| format!("解析 Anthropic 响应失败: {}", e))?;
    let mut content_parts = Vec::new();
    let mut thinking_parts = Vec::new();

    for block in parsed.content {
        if block.block_type.as_deref() == Some("thinking") {
            if let Some(thinking) = block.thinking.or(block.text) {
                let trimmed = thinking.trim();
                if !trimmed.is_empty() {
                    thinking_parts.push(trimmed.to_string());
                }
            }
        } else if let Some(text) = block.text {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                content_parts.push(trimmed.to_string());
            }
        }
    }

    let content = content_parts.join("\n\n");
    let reasoning_content = if thinking_parts.is_empty() {
        None
    } else {
        Some(thinking_parts.join("\n\n"))
    };

    if content.is_empty() && reasoning_content.is_none() {
        return Err("AI 返回了空结果".to_string());
    }

    Ok(AiChatResponse {
        content,
        reasoning_content,
        model: parsed.model,
        usage: parsed.usage.map(|usage| AiTokenUsage {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            total_tokens: match (usage.input_tokens, usage.output_tokens) {
                (Some(input), Some(output)) => Some(input + output),
                _ => None,
            },
        }),
    })
}

fn parse_gemini_response(response_text: &str, model: &str) -> Result<AiChatResponse, String> {
    let parsed: GeminiResponse = serde_json::from_str(response_text)
        .map_err(|e| format!("解析 Gemini 响应失败: {}", e))?;
    let mut content_parts = Vec::new();
    let mut thinking_parts = Vec::new();

    for candidate in parsed.candidates.unwrap_or_default() {
        if let Some(content) = candidate.content {
            for part in content.parts.unwrap_or_default() {
                if let Some(text) = part.text {
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if part.thought.unwrap_or(false) {
                        thinking_parts.push(trimmed.to_string());
                    } else {
                        content_parts.push(trimmed.to_string());
                    }
                }
            }
        }
    }

    let content = content_parts.join("\n\n");
    let reasoning_content = if thinking_parts.is_empty() {
        None
    } else {
        Some(thinking_parts.join("\n\n"))
    };

    if content.is_empty() && reasoning_content.is_none() {
        return Err("AI 返回了空结果".to_string());
    }

    Ok(AiChatResponse {
        content,
        reasoning_content,
        model: Some(model.to_string()),
        usage: parsed.usage_metadata.map(|usage| AiTokenUsage {
            input_tokens: usage.prompt_token_count,
            output_tokens: usage.candidates_token_count,
            total_tokens: usage.total_token_count,
        }),
    })
}

fn parse_ollama_response(response_text: &str) -> Result<AiChatResponse, String> {
    let parsed: OllamaResponse = serde_json::from_str(response_text)
        .map_err(|e| format!("解析 Ollama 响应失败: {}", e))?;
    let content = parsed
        .message
        .as_ref()
        .and_then(|message| message.content.clone())
        .or(parsed.response)
        .unwrap_or_default()
        .trim()
        .to_string();
    let reasoning_content = parsed
        .message
        .and_then(|message| message.thinking)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());

    if content.is_empty() && reasoning_content.is_none() {
        return Err("AI 返回了空结果".to_string());
    }

    Ok(AiChatResponse {
        content,
        reasoning_content,
        model: parsed.model,
        usage: Some(AiTokenUsage {
            input_tokens: parsed.prompt_eval_count,
            output_tokens: parsed.eval_count,
            total_tokens: match (parsed.prompt_eval_count, parsed.eval_count) {
                (Some(input), Some(output)) => Some(input + output),
                _ => None,
            },
        }),
    })
}

fn first_string_field(value: &Value, fields: &[&str]) -> Option<String> {
    for field in fields {
        if let Some(text) = value.get(field).and_then(|item| item.as_str()) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn first_raw_string_field(value: &Value, fields: &[&str]) -> Option<String> {
    for field in fields {
        if let Some(text) = value.get(field).and_then(|item| item.as_str()) {
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}

fn parse_openai_usage_value(value: Option<&Value>) -> Option<AiTokenUsage> {
    let usage = value?;
    Some(AiTokenUsage {
        input_tokens: usage.get("prompt_tokens").and_then(|item| item.as_u64()),
        output_tokens: usage.get("completion_tokens").and_then(|item| item.as_u64()),
        total_tokens: usage.get("total_tokens").and_then(|item| item.as_u64()),
    })
}

fn collect_openai_stream_delta(
    data: &str,
    content: &mut String,
    reasoning_content: &mut String,
    model: &mut Option<String>,
    usage: &mut Option<AiTokenUsage>,
) -> Result<(Option<String>, Option<String>), String> {
    let parsed: Value = serde_json::from_str(data)
        .map_err(|e| format!("解析 AI 流式响应失败: {}", e))?;

    if model.is_none() {
        *model = parsed
            .get("model")
            .and_then(|item| item.as_str())
            .map(|text| text.to_string());
    }
    if let Some(parsed_usage) = parse_openai_usage_value(parsed.get("usage")) {
        *usage = Some(parsed_usage);
    }

    let mut content_delta = String::new();
    let mut reasoning_delta = String::new();
    if let Some(choices) = parsed.get("choices").and_then(|item| item.as_array()) {
        for choice in choices {
            if let Some(delta) = choice.get("delta") {
                if let Some(text) = first_raw_string_field(delta, &["content"]) {
                    content_delta.push_str(&text);
                }
                if let Some(text) = first_raw_string_field(
                    delta,
                    &["reasoning_content", "reasoning", "thinking"],
                ) {
                    reasoning_delta.push_str(&text);
                }
            }
        }
    }

    let content_delta = if content_delta.is_empty() {
        None
    } else {
        content.push_str(&content_delta);
        Some(content_delta)
    };
    let reasoning_delta = if reasoning_delta.is_empty() {
        None
    } else {
        reasoning_content.push_str(&reasoning_delta);
        Some(reasoning_delta)
    };

    Ok((content_delta, reasoning_delta))
}

fn emit_ai_chat_stream_delta(
    app: &AppHandle,
    stream_id: &str,
    content_delta: Option<String>,
    reasoning_delta: Option<String>,
) {
    if content_delta.is_none() && reasoning_delta.is_none() {
        return;
    }

    let _ = app.emit(
        "ai-chat-stream",
        AiChatStreamEvent {
            stream_id: stream_id.to_string(),
            content_delta,
            reasoning_delta,
        },
    );
}

fn is_ai_stream_cancelled(app: &AppHandle, stream_id: &str) -> bool {
    app.state::<CancelledAiStreams>()
        .0
        .lock()
        .map(|cancelled| cancelled.contains(stream_id))
        .unwrap_or(false)
}

fn clear_ai_stream_cancelled(app: &AppHandle, stream_id: &str) {
    if let Ok(mut cancelled) = app.state::<CancelledAiStreams>().0.lock() {
        cancelled.remove(stream_id);
    }
}

fn parse_custom_response(response_text: &str, model: &str) -> Result<AiChatResponse, String> {
    if let Ok(response) = parse_openai_response(response_text) {
        return Ok(response);
    }

    let parsed: Value = serde_json::from_str(response_text)
        .map_err(|e| format!("解析 Custom 响应失败: {}", e))?;
    let content = first_string_field(&parsed, &["content", "text", "answer", "response", "output"])
        .unwrap_or_default();

    if content.is_empty() {
        return Err("AI 返回了空结果".to_string());
    }

    Ok(AiChatResponse {
        content,
        reasoning_content: first_string_field(&parsed, &["reasoning_content", "reasoning", "thinking"]),
        model: first_string_field(&parsed, &["model"]).or_else(|| Some(model.to_string())),
        usage: None,
    })
}

fn compact_ai_error_response(response_text: &str) -> String {
    let trimmed = response_text.trim();
    if trimmed.is_empty() {
        return "服务返回空错误内容".to_string();
    }

    const MAX_ERROR_LENGTH: usize = 600;
    if trimmed.chars().count() > MAX_ERROR_LENGTH {
        let preview: String = trimmed.chars().take(MAX_ERROR_LENGTH).collect();
        format!("{}...", preview)
    } else {
        trimmed.to_string()
    }
}

fn ensure_success(
    status: reqwest::StatusCode,
    endpoint: &str,
    response_text: String,
) -> Result<String, String> {
    if status.is_success() {
        return Ok(response_text);
    }

    Err(format!(
        "AI 服务返回错误 {}\n请求: POST {}\n响应: {}",
        status.as_u16(),
        endpoint,
        compact_ai_error_response(&response_text)
    ))
}

async fn send_openai_like_request(
    client: &reqwest::Client,
    request: &AiChatRequest,
    endpoint: &str,
    api_key: Option<String>,
    require_key: bool,
) -> Result<String, String> {
    let api_key = if require_key {
        Some(require_ai_credential(api_key, "OpenAI Compatible")?)
    } else {
        api_key
    };
    let body = openai_like_request_body(request, false);

    let mut builder = client
        .post(endpoint)
        .json(&body);
    if let Some(api_key) = api_key {
        builder = builder.bearer_auth(api_key);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("AI 请求失败: {}", e))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("读取 AI 响应失败: {}", e))?;

    ensure_success(status, endpoint, response_text)
}

async fn send_openai_like_stream_request(
    client: &reqwest::Client,
    request: &AiChatRequest,
    endpoint: &str,
    api_key: Option<String>,
    require_key: bool,
    app: &AppHandle,
    stream_id: &str,
) -> Result<AiChatResponse, String> {
    let api_key = if require_key {
        Some(require_ai_credential(api_key, "OpenAI Compatible")?)
    } else {
        api_key
    };
    let body = openai_like_request_body(request, true);

    if is_ai_stream_cancelled(app, stream_id) {
        return Err("AI 请求已取消".to_string());
    }

    let mut builder = client.post(endpoint).json(&body);
    if let Some(api_key) = api_key {
        builder = builder.bearer_auth(api_key);
    }

    let mut response = builder
        .send()
        .await
        .map_err(|e| format!("AI 请求失败: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        let response_text = response
            .text()
            .await
            .map_err(|e| format!("读取 AI 响应失败: {}", e))?;
        return ensure_success(status, endpoint, response_text).map(|_| AiChatResponse {
            content: String::new(),
            reasoning_content: None,
            model: None,
            usage: None,
        });
    }

    let mut buffer = String::new();
    let mut content = String::new();
    let mut reasoning_content = String::new();
    let mut model = None;
    let mut usage = None;
    let mut done = false;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取 AI 流式响应失败: {}", e))?
    {
        if is_ai_stream_cancelled(app, stream_id) {
            return Err("AI 请求已取消".to_string());
        }

        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(line_end) = buffer.find('\n') {
            if is_ai_stream_cancelled(app, stream_id) {
                return Err("AI 请求已取消".to_string());
            }

            let line: String = buffer.drain(..=line_end).collect();
            let line = line.trim();
            if !line.starts_with("data:") {
                continue;
            }

            let data = line.trim_start_matches("data:").trim();
            if data == "[DONE]" {
                done = true;
                break;
            }
            if data.is_empty() {
                continue;
            }

            let (content_delta, reasoning_delta) = collect_openai_stream_delta(
                data,
                &mut content,
                &mut reasoning_content,
                &mut model,
                &mut usage,
            )?;
            emit_ai_chat_stream_delta(app, stream_id, content_delta, reasoning_delta);
        }

        if done {
            break;
        }
    }

    if content.is_empty() && reasoning_content.is_empty() {
        return Err("AI 返回了空结果".to_string());
    }

    Ok(AiChatResponse {
        content,
        reasoning_content: if reasoning_content.is_empty() {
            None
        } else {
            Some(reasoning_content)
        },
        model,
        usage,
    })
}

async fn send_anthropic_request(
    client: &reqwest::Client,
    request: &AiChatRequest,
    endpoint: &str,
    api_key: String,
) -> Result<String, String> {
    let system = request.messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.trim())
        .filter(|content| !content.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let messages: Vec<_> = request.messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| json!({
            "role": if message.role == "assistant" { "assistant" } else { "user" },
            "content": message.content,
        }))
        .collect();

    let mut body = json!({
        "model": request.model,
        "max_tokens": request.max_tokens.unwrap_or(4096),
        "messages": messages,
    });
    if !system.is_empty() {
        body["system"] = json!(system);
    }
    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(top_p) = request.top_p {
        body["top_p"] = json!(top_p);
    }
    if request.enable_thinking.unwrap_or(false) {
        body["thinking"] = json!({
            "type": "enabled",
            "budget_tokens": request.thinking_budget.unwrap_or(1024),
        });
    }

    let response = client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI 请求失败: {}", e))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("读取 AI 响应失败: {}", e))?;

    ensure_success(status, endpoint, response_text)
}

async fn send_gemini_request(
    client: &reqwest::Client,
    request: &AiChatRequest,
    endpoint: &str,
    api_key: Option<String>,
) -> Result<String, String> {
    let mut system_parts = Vec::new();
    let contents: Vec<_> = request.messages
        .iter()
        .filter_map(|message| {
            if message.role == "system" {
                system_parts.push(json!({ "text": message.content }));
                return None;
            }

            Some(json!({
                "role": if message.role == "assistant" { "model" } else { "user" },
                "parts": [{ "text": message.content }],
            }))
        })
        .collect();

    let mut body = json!({
        "contents": contents,
    });
    if !system_parts.is_empty() {
        body["systemInstruction"] = json!({ "parts": system_parts });
    }

    let mut generation_config = json!({});
    if let Some(temperature) = request.temperature {
        generation_config["temperature"] = json!(temperature);
    }
    if let Some(top_p) = request.top_p {
        generation_config["topP"] = json!(top_p);
    }
    if let Some(max_tokens) = request.max_tokens {
        generation_config["maxOutputTokens"] = json!(max_tokens);
    }
    if let Some(enable_thinking) = request.enable_thinking {
        if enable_thinking {
            if let Some(thinking_budget) = request.thinking_budget {
                generation_config["thinkingConfig"] = json!({ "thinkingBudget": thinking_budget });
            }
        } else {
            generation_config["thinkingConfig"] = json!({ "thinkingBudget": 0 });
        }
    }
    if generation_config.as_object().map(|object| !object.is_empty()).unwrap_or(false) {
        body["generationConfig"] = generation_config;
    }

    let mut builder = client.post(endpoint).json(&body);
    if let Some(api_key) = api_key {
        builder = builder.header("x-goog-api-key", api_key);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("AI 请求失败: {}", e))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("读取 AI 响应失败: {}", e))?;

    ensure_success(status, endpoint, response_text)
}

async fn send_ollama_request(
    client: &reqwest::Client,
    request: &AiChatRequest,
    endpoint: &str,
) -> Result<String, String> {
    let mut options = json!({});
    if let Some(temperature) = request.temperature {
        options["temperature"] = json!(temperature);
    }
    if let Some(top_p) = request.top_p {
        options["top_p"] = json!(top_p);
    }
    if let Some(max_tokens) = request.max_tokens {
        options["num_predict"] = json!(max_tokens);
    }

    let mut body = json!({
        "model": request.model,
        "messages": request_messages(&request.messages),
        "stream": false,
    });
    if options.as_object().map(|object| !object.is_empty()).unwrap_or(false) {
        body["options"] = options;
    }
    if let Some(enable_thinking) = request.enable_thinking {
        body["think"] = json!(enable_thinking);
    }

    let response = client
        .post(endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI 请求失败: {}", e))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("读取 AI 响应失败: {}", e))?;

    ensure_success(status, endpoint, response_text)
}

// ── Command: send AI chat request from the Rust side ──
#[command]
async fn ai_send_chat(request: AiChatRequest) -> Result<AiChatResponse, String> {
    let endpoint = ai_request_endpoint(&request.provider_type, &request.api_url)?;
    let credential = resolve_ai_credential(request.credential_ref.as_deref())?;
    let client = reqwest::Client::new();

    match request.provider_type.as_str() {
        "openai-compatible" => {
            let response_text = send_openai_like_request(&client, &request, &endpoint, credential, true).await?;
            parse_openai_response(&response_text)
        }
        "anthropic" => {
            let api_key = require_ai_credential(credential, "Anthropic")?;
            let response_text = send_anthropic_request(&client, &request, &endpoint, api_key).await?;
            parse_anthropic_response(&response_text)
        }
        "gemini" => {
            let response_text = send_gemini_request(&client, &request, &endpoint, credential).await?;
            parse_gemini_response(&response_text, &request.model)
        }
        "ollama" => {
            let response_text = send_ollama_request(&client, &request, &endpoint).await?;
            parse_ollama_response(&response_text)
        }
        "custom" => {
            let response_text = send_openai_like_request(&client, &request, &endpoint, credential, false).await?;
            parse_custom_response(&response_text, &request.model)
        }
        other => Err(format!("暂不支持的模型供应商类型: {}", other)),
    }
}

// ── Command: send streaming AI chat request from the Rust side ──
#[command]
async fn ai_send_chat_stream(app: AppHandle, request: AiChatRequest) -> Result<AiChatResponse, String> {
    let Some(stream_id) = request.stream_id.clone() else {
        return Err("流式请求缺少 streamId".to_string());
    };
    let endpoint = ai_request_endpoint(&request.provider_type, &request.api_url)?;
    let credential = resolve_ai_credential(request.credential_ref.as_deref())?;
    let client = reqwest::Client::new();

    let result = match request.provider_type.as_str() {
        "openai-compatible" => {
            send_openai_like_stream_request(
                &client,
                &request,
                &endpoint,
                credential,
                true,
                &app,
                &stream_id,
            )
            .await
        }
        "custom" => {
            send_openai_like_stream_request(
                &client,
                &request,
                &endpoint,
                credential,
                false,
                &app,
                &stream_id,
            )
            .await
        }
        _ => ai_send_chat(request).await,
    };

    clear_ai_stream_cancelled(&app, &stream_id);
    result
}

// ── Command: cancel an active streaming AI chat request ──
#[command]
fn ai_cancel_chat_stream(app: AppHandle, stream_id: String) -> Result<(), String> {
    if stream_id.trim().is_empty() {
        return Err("流式请求 ID 为空".to_string());
    }

    app.state::<CancelledAiStreams>()
        .0
        .lock()
        .map_err(|_| "取消 AI 请求失败".to_string())?
        .insert(stream_id);
    Ok(())
}

// ── Command: ensure config directory exists ──
#[command]
fn ensure_config_dir() -> Result<String, String> {
    let config_dir = user_home_dir()?.join(".orcha-writer").join("config");
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("创建配置目录失败: {}", e))?;
    Ok(config_dir.to_string_lossy().to_string())
}

// ── PDF Export Types ──

#[derive(Serialize, Deserialize)]
struct PdfEngineStatus {
    engine: String,
    available: bool,
    label: String,
    reason: Option<String>,
    version: Option<String>,
    path: Option<String>,
}

#[derive(Serialize)]
struct PdfExportResult {
    success: bool,
    output_path: Option<String>,
    error: Option<String>,
}

// ── Command: detect PDF engines ──
#[command]
fn detect_pdf_engines() -> Vec<PdfEngineStatus> {
    let mut results = Vec::new();

    // system_print is always available
    results.push(PdfEngineStatus {
        engine: "system_print".to_string(),
        available: true,
        label: "系统打印".to_string(),
        reason: None,
        version: None,
        path: None,
    });

    // Detect Chrome / Edge
    let chrome_paths = detect_chrome_path();
    if let Some(path) = chrome_paths.first() {
        let version = get_chrome_version(path.clone());
        results.push(PdfEngineStatus {
            engine: "system_chrome".to_string(),
            available: true,
            label: "系统 Chrome".to_string(),
            reason: None,
            version,
            path: Some(path.clone()),
        });
    } else {
        results.push(PdfEngineStatus {
            engine: "system_chrome".to_string(),
            available: false,
            label: "系统 Chrome".to_string(),
            reason: Some("未检测到 Chrome / Edge".to_string()),
            version: None,
            path: None,
        });
    }

    results
}

fn detect_chrome_path() -> Vec<String> {
    let mut paths = Vec::new();

    // macOS Chrome paths
    let mac_paths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
    for p in &mac_paths {
        if PathBuf::from(p).exists() {
            paths.push(p.to_string());
        }
    }

    // Linux Chrome paths
    let linux_paths = [
        "google-chrome",
        "google-chrome-stable",
        "chromium-browser",
        "chromium",
        "microsoft-edge",
    ];
    for cmd in &linux_paths {
        if which(cmd).is_some() {
            paths.push(cmd.to_string());
        }
    }

    // Windows Chrome paths
    let win_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ];
    for p in &win_paths {
        if PathBuf::from(p).exists() {
            paths.push(p.to_string());
        }
    }

    paths
}

fn which(cmd: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .filter_map(|dir| {
                let full_path = dir.join(cmd);
                if full_path.is_file() {
                    Some(full_path)
                } else {
                    None
                }
            })
            .next()
    })
}

fn get_chrome_version(chrome_path: String) -> Option<String> {
    let output = std::process::Command::new(&chrome_path)
        .arg("--version")
        .output();

    match output {
        Ok(out) => {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if version.is_empty() {
                String::from_utf8_lossy(&out.stderr).trim().to_string().into()
            } else {
                Some(version)
            }
        }
        Err(_) => None,
    }
}

// ── Command: export PDF using system Chrome (headless) ──
#[command]
fn export_pdf_chrome(html_content: String, output_path: String, chrome_path: Option<String>) -> PdfExportResult {
    let chrome = match chrome_path {
        Some(p) => p,
        None => detect_chrome_path().into_iter().next().unwrap_or_default(),
    };

    if chrome.is_empty() {
        return PdfExportResult {
            success: false,
            output_path: None,
            error: Some("未找到 Chrome / Edge".to_string()),
        };
    }

    // Create temp HTML file
    let temp_dir = std::env::temp_dir();
    let temp_html = temp_dir.join("orcha-pdf-export.html");
    if let Err(e) = std::fs::write(&temp_html, &html_content) {
        return PdfExportResult {
            success: false,
            output_path: None,
            error: Some(format!("创建临时文件失败: {}", e)),
        };
    }

    // Run Chrome headless to generate PDF
    let output = std::process::Command::new(&chrome)
        .args([
            "--headless",
            "--disable-gpu",
            "--no-pdf-header-footer",
            "--no-first-run",
            &format!("--print-to-pdf={}", output_path),
            &format!("file://{}", temp_html.to_string_lossy()),
        ])
        .output();

    // Clean up temp file
    let _ = std::fs::remove_file(&temp_html);

    match output {
        Ok(out) => {
            if out.status.success() && PathBuf::from(&output_path).exists() {
                PdfExportResult {
                    success: true,
                    output_path: Some(output_path),
                    error: None,
                }
            } else {
                PdfExportResult {
                    success: false,
                    output_path: None,
                    error: Some(format!("Chrome 导出失败: {}", String::from_utf8_lossy(&out.stderr))),
                }
            }
        }
        Err(e) => PdfExportResult {
            success: false,
            output_path: None,
            error: Some(format!("启动 Chrome 失败: {}", e)),
        },
    }
}

// ── Command: export PDF using system print (opens print dialog) ──
#[command]
fn export_pdf_system_print(app: tauri::AppHandle) {
    // Trigger window.print() to open system print dialog
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.print();");
    }
}

fn set_native_menu(handle: &AppHandle, language: &str) -> tauri::Result<()> {
    let english = language == "en-US";
    let t = |zh: &'static str, en: &'static str| if english { en } else { zh };

    let file_menu = SubmenuBuilder::new(handle, t("文件", "File"))
        .item(&MenuItemBuilder::new(t("新建文件", "New File")).id("new_file").build(handle)?)
        .item(&MenuItemBuilder::new(t("新建纯文本", "New Plain Text")).id("new_text_file").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("打开文件", "Open File")).id("open_file").build(handle)?)
        .item(&MenuItemBuilder::new(t("打开文件夹", "Open Folder")).id("open_folder").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("保存", "Save")).id("save").build(handle)?)
        .item(&MenuItemBuilder::new(t("另存为", "Save As")).id("save_as").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("关闭文件", "Close File")).id("close_file").build(handle)?)
        .item(&MenuItemBuilder::new(t("最近打开", "Recent Files")).id("recent_files").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("退出", "Quit")).id("quit").accelerator("CmdOrCtrl+Q").build(handle)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(handle, t("编辑", "Edit"))
        .undo_with_text(t("撤销", "Undo"))
        .redo_with_text(t("重做", "Redo"))
        .separator()
        .cut_with_text(t("剪切", "Cut"))
        .copy_with_text(t("复制", "Copy"))
        .paste_with_text(t("粘贴", "Paste"))
        .select_all_with_text(t("全选", "Select All"))
        .separator()
        .item(&MenuItemBuilder::new(t("查找", "Find")).id("find").accelerator("CmdOrCtrl+F").build(handle)?)
        .item(&MenuItemBuilder::new(t("替换", "Replace")).id("replace").accelerator("CmdOrCtrl+H").build(handle)?)
        .item(&MenuItemBuilder::new(t("命令面板", "Command Palette")).id("command_palette").accelerator("CmdOrCtrl+Shift+P").build(handle)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(handle, t("视图", "View"))
        .item(&MenuItemBuilder::new(t("编辑模式", "Edit Mode")).id("view_edit").build(handle)?)
        .item(&MenuItemBuilder::new(t("预览模式", "Preview Mode")).id("view_preview").build(handle)?)
        .item(&MenuItemBuilder::new(t("双栏模式", "Split Mode")).id("view_split").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("显示 / 隐藏侧边栏", "Show / Hide Sidebar")).id("toggle_sidebar").build(handle)?)
        .item(&MenuItemBuilder::new(t("显示 / 隐藏大纲", "Show / Hide Outline")).id("toggle_outline").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("放大", "Zoom In")).id("zoom_in").build(handle)?)
        .item(&MenuItemBuilder::new(t("缩小", "Zoom Out")).id("zoom_out").build(handle)?)
        .item(&MenuItemBuilder::new(t("重置缩放", "Reset Zoom")).id("reset_zoom").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("浅色主题", "Light Theme")).id("theme_light").build(handle)?)
        .item(&MenuItemBuilder::new(t("深色主题", "Dark Theme")).id("theme_dark").build(handle)?)
        .item(&MenuItemBuilder::new(t("跟随系统", "Follow System")).id("theme_system").build(handle)?)
        .build()?;

    let insert_menu = SubmenuBuilder::new(handle, t("插入", "Insert"))
        .item(&MenuItemBuilder::new(t("插入图片", "Insert Image")).id("insert_image").build(handle)?)
        .item(&MenuItemBuilder::new(t("插入链接", "Insert Link")).id("insert_link").build(handle)?)
        .item(&MenuItemBuilder::new(t("插入表格", "Insert Table")).id("insert_table").build(handle)?)
        .item(&MenuItemBuilder::new(t("插入代码块", "Insert Code Block")).id("insert_code").build(handle)?)
        .item(&MenuItemBuilder::new(t("插入分割线", "Insert Divider")).id("insert_hr").build(handle)?)
        .item(&MenuItemBuilder::new(t("插入任务列表", "Insert Task List")).id("insert_task").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("插入当前日期", "Insert Current Date")).id("insert_date").build(handle)?)
        .build()?;

    let export_menu = SubmenuBuilder::new(handle, t("导出", "Export"))
        .item(&MenuItemBuilder::new(t("导出为 PDF", "Export as PDF")).id("export_pdf").build(handle)?)
        .item(&MenuItemBuilder::new(t("导出为 HTML", "Export as HTML")).id("export_html").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("导出设置", "Export Settings")).id("export_settings").build(handle)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(handle, t("窗口", "Window"))
        .item(&MenuItemBuilder::new(t("最小化", "Minimize")).id("minimize").build(handle)?)
        .item(&MenuItemBuilder::new(t("最大化", "Maximize")).id("maximize").build(handle)?)
        .item(&MenuItemBuilder::new(t("关闭窗口", "Close Window")).id("close_window").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("切换上一个标签", "Previous Tab")).id("prev_tab").build(handle)?)
        .item(&MenuItemBuilder::new(t("切换下一个标签", "Next Tab")).id("next_tab").build(handle)?)
        .build()?;

    let system_menu = SubmenuBuilder::new(handle, t("系统", "System"))
        .item(&MenuItemBuilder::new(t("打开终端", "Open Terminal")).id("open_terminal").build(handle)?)
        .item(&MenuItemBuilder::new(t("调试模式", "Debug Mode")).id("toggle_debug_mode").accelerator("CmdOrCtrl+Alt+I").build(handle)?)
        .build()?;

    let help_menu = SubmenuBuilder::new(handle, t("帮助", "Help"))
        .item(&MenuItemBuilder::new(t("Markdown 语法帮助", "Markdown Syntax Help")).id("markdown_help").build(handle)?)
        .item(&MenuItemBuilder::new(t("快捷键说明", "Keyboard Shortcuts")).id("shortcut_help").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("检查更新", "Check for Updates")).id("check_update").build(handle)?)
        .separator()
        .item(&MenuItemBuilder::new(t("关于 Orcha Writer", "About Orcha Writer")).id("about").build(handle)?)
        .build()?;

    let menu = MenuBuilder::new(handle)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&insert_menu)
        .item(&export_menu)
        .item(&window_menu)
        .item(&system_menu)
        .item(&help_menu)
        .build()?;

    handle.set_menu(menu).map(|_| ())
}

#[command]
fn set_app_menu_language(app: AppHandle, language: String) -> Result<(), String> {
    set_native_menu(&app, &language).map_err(|e| e.to_string())
}

fn main() {
    // Collect text/code files from CLI arguments (cold start)
    let initial_paths = collect_openable_text_paths(
        std::env::args().collect(),
        std::env::current_dir().ok(),
    );

    tauri::Builder::default()
        .manage(PendingOpenFiles(Mutex::new(initial_paths)))
        .manage(CancelledAiStreams::default())
        .manage(TerminalManager::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths = collect_openable_text_paths(args, None);
            push_and_emit_open_files(app, paths);
        }))
        .invoke_handler(tauri::generate_handler![
            take_pending_open_files,
            exit_app,
            open_markdown_file,
            import_pdf_text_as_markdown,
            read_directory_entries,
            read_file_content,
            write_file_content,
            write_binary_file,
            read_binary_file,
            create_dir_all,
            copy_file_content,
            read_clipboard_image,
            read_clipboard_file_urls,
            path_exists,
            delete_path,
            rename_path,
            reveal_path_in_file_manager,
            open_terminal_at,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_kill,
            ai_send_chat,
            ai_send_chat_stream,
            ai_cancel_chat_stream,
            ensure_config_dir,
            detect_pdf_engines,
            export_pdf_chrome,
            export_pdf_system_print,
            set_app_menu_language,
        ])
        .setup(|app| {
            let handle = app.handle();

            set_native_menu(handle, "zh-CN")?;

            // Window-level file drop handler
            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            window.on_webview_event(move |event| {
                if let WebviewEvent::DragDrop(DragDropEvent::Drop { paths, position: _ }) = event {
                    let text_paths: Vec<String> = paths
                        .iter()
                        .filter(|p| is_openable_text_file(p))
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    if !text_paths.is_empty() {
                        window_clone.emit("files-dropped", text_paths).ok();
                    }
                }
            });

            Ok(())
        })
        .on_menu_event(|app, event| {
            let window = app.get_webview_window("main").unwrap();
            let id = event.id().0.as_str();

            match id {
                "new_file" => { window.emit("menu-action", "new_file").ok(); }
                "new_text_file" => { window.emit("menu-action", "new_text_file").ok(); }
                "open_file" => { window.emit("menu-action", "open_file").ok(); }
                "open_folder" => { window.emit("menu-action", "open_folder").ok(); }
                "save" => { window.emit("menu-action", "save").ok(); }
                "save_as" => { window.emit("menu-action", "save_as").ok(); }
                "close_file" => { window.emit("menu-action", "close_file").ok(); }
                "recent_files" => { window.emit("menu-action", "recent_files").ok(); }
                "quit" => { window.close().ok(); }
                "find" => { window.emit("menu-action", "find").ok(); }
                "replace" => { window.emit("menu-action", "replace").ok(); }
                "command_palette" => { window.emit("menu-action", "command_palette").ok(); }
                "view_edit" => { window.emit("menu-action", "view_edit").ok(); }
                "view_preview" => { window.emit("menu-action", "view_preview").ok(); }
                "view_split" => { window.emit("menu-action", "view_split").ok(); }
                "toggle_sidebar" => { window.emit("menu-action", "toggle_sidebar").ok(); }
                "toggle_outline" => { window.emit("menu-action", "toggle_outline").ok(); }
                "theme_light" => { window.emit("menu-action", "theme_light").ok(); }
                "theme_dark" => { window.emit("menu-action", "theme_dark").ok(); }
                "theme_system" => { window.emit("menu-action", "theme_system").ok(); }
                "minimize" => { window.minimize().ok(); }
                "maximize" => { window.maximize().ok(); }
                "close_window" => { window.close().ok(); }
                "export_pdf" => { window.emit("menu-action", "export_pdf").ok(); }
                "export_html" => { window.emit("menu-action", "export_html").ok(); }
                "export_settings" => { window.emit("menu-action", "export_settings").ok(); }
                "undo" => { window.emit("menu-action", "undo").ok(); }
                "redo" => { window.emit("menu-action", "redo").ok(); }
                "cut" => { window.emit("menu-action", "cut").ok(); }
                "copy" => { window.emit("menu-action", "copy").ok(); }
                "paste" => { window.emit("menu-action", "paste").ok(); }
                "select_all" => { window.emit("menu-action", "select_all").ok(); }
                "insert_image" => { window.emit("menu-action", "insert_image").ok(); }
                "insert_link" => { window.emit("menu-action", "insert_link").ok(); }
                "insert_table" => { window.emit("menu-action", "insert_table").ok(); }
                "insert_code" => { window.emit("menu-action", "insert_code").ok(); }
                "insert_hr" => { window.emit("menu-action", "insert_hr").ok(); }
                "insert_task" => { window.emit("menu-action", "insert_task").ok(); }
                "insert_date" => { window.emit("menu-action", "insert_date").ok(); }
                "prev_tab" => { window.emit("menu-action", "prev_tab").ok(); }
                "next_tab" => { window.emit("menu-action", "next_tab").ok(); }
                "zoom_in" => { window.emit("menu-action", "zoom_in").ok(); }
                "zoom_out" => { window.emit("menu-action", "zoom_out").ok(); }
                "reset_zoom" => { window.emit("menu-action", "reset_zoom").ok(); }
                "open_terminal" => { window.emit("menu-action", "open_terminal").ok(); }
                "toggle_debug_mode" => {
                    if window.is_devtools_open() {
                        window.close_devtools();
                    } else {
                        window.open_devtools();
                    }
                }
                "markdown_help" => { window.emit("menu-action", "markdown_help").ok(); }
                "shortcut_help" => { window.emit("menu-action", "shortcut_help").ok(); }
                "check_update" => { window.emit("menu-action", "check_update").ok(); }
                "about" => { window.emit("menu-action", "about").ok(); }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            {
                // macOS: handle Opened event from Finder (dock drop, right-click open).
                if let tauri::RunEvent::Opened { urls } = &_event {
                    let paths: Vec<String> = urls
                        .iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .filter(|path| path.exists() && path.is_file() && is_openable_text_file(path))
                        .map(|path| path.to_string_lossy().to_string())
                        .collect();
                    push_and_emit_open_files(_app_handle, paths);
                }
            }
        });
}
