#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewEvent, DragDropEvent};
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder};
use tauri::command;
use serde::{Serialize, Deserialize};
use serde_json::json;

// ── PendingOpenFiles: stores files to open from cold start or Opened events ──
#[derive(Default)]
struct PendingOpenFiles(Mutex<Vec<String>>);

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
struct AiOpenAiCompatibleRequest {
    base_url: String,
    credential_ref: String,
    model: String,
    messages: Vec<AiChatMessageInput>,
    temperature: Option<f64>,
    top_p: Option<f64>,
    max_tokens: Option<u32>,
    enable_thinking: Option<bool>,
    thinking_budget: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiTokenUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiOpenAiCompatibleResponse {
    content: String,
    reasoning_content: Option<String>,
    model: Option<String>,
    usage: Option<AiTokenUsage>,
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

// ── Utility: check if a path is a markdown file ──
fn is_markdown_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd"
            )
        })
        .unwrap_or(false)
}

// ── Collect markdown file paths from CLI arguments ──
fn collect_markdown_paths(args: Vec<String>, cwd: Option<PathBuf>) -> Vec<String> {
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
            if path.exists() && path.is_file() && is_markdown_file(&path) {
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

// ── Command: Rust securely reads a markdown file ──
#[command]
fn open_markdown_file(path: String) -> Result<OpenedDocument, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err("文件不存在".to_string());
    }
    if !path_buf.is_file() {
        return Err("目标路径不是文件".to_string());
    }
    if !is_markdown_file(&path_buf) {
        return Err("不支持的文件类型".to_string());
    }
    let metadata = std::fs::metadata(&path_buf).map_err(|e| e.to_string())?;
    const MAX_FILE_SIZE: u64 = 20 * 1024 * 1024; // 20MB
    if metadata.len() > MAX_FILE_SIZE {
        return Err("文件过大，暂不支持打开超过 20MB 的 Markdown 文件".to_string());
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
    std::fs::write(&file_path, &content)
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

fn resolve_ai_credential(credential_ref: &str) -> Result<String, String> {
    let value = credential_ref.trim();
    if value.is_empty() {
        return Err("模型凭据未配置".to_string());
    }

    if let Some(name) = value.strip_prefix("env:") {
        let env_name = name.trim();
        if env_name.is_empty() {
            return Err("环境变量凭据名称为空".to_string());
        }
        return std::env::var(env_name)
            .map_err(|_| format!("未读取到环境变量 {}", env_name));
    }

    if value.starts_with("secret:") {
        return Err("secret 凭据读取尚未接入，请先使用 env:环境变量名 或临时填入 API Key".to_string());
    }

    Ok(value.to_string())
}

fn ai_chat_endpoint(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim_end_matches('/'))
}

// ── Command: send OpenAI-compatible chat request from the Rust side ──
#[command]
async fn ai_send_openai_compatible(request: AiOpenAiCompatibleRequest) -> Result<AiOpenAiCompatibleResponse, String> {
    let api_key = resolve_ai_credential(&request.credential_ref)?;
    let endpoint = ai_chat_endpoint(&request.base_url);
    let messages: Vec<_> = request.messages
        .iter()
        .map(|message| json!({
            "role": message.role,
            "content": message.content,
        }))
        .collect();

    let mut body = json!({
        "model": request.model,
        "messages": messages,
        "stream": false,
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

    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI 请求失败: {}", e))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("读取 AI 响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("AI 服务返回错误 {}: {}", status.as_u16(), response_text));
    }

    let parsed: OpenAiChatResponse = serde_json::from_str(&response_text)
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

    Ok(AiOpenAiCompatibleResponse {
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

// ── Command: ensure config directory exists ──
#[command]
fn ensure_config_dir() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| format!("获取HOME失败: {}", e))?;
    let config_dir = PathBuf::from(&home).join(".orcha-writer").join("config");
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

fn main() {
    // Collect markdown files from CLI arguments (cold start)
    let initial_paths = collect_markdown_paths(
        std::env::args().collect(),
        std::env::current_dir().ok(),
    );

    tauri::Builder::default()
        .manage(PendingOpenFiles(Mutex::new(initial_paths)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths = collect_markdown_paths(args, None);
            push_and_emit_open_files(app, paths);
        }))
        .invoke_handler(tauri::generate_handler![
            take_pending_open_files,
            exit_app,
            open_markdown_file,
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
            ai_send_openai_compatible,
            ensure_config_dir,
            detect_pdf_engines,
            export_pdf_chrome,
            export_pdf_system_print,
        ])
        .setup(|app| {
            let handle = app.handle();

            // Build native menu
            let file_menu = SubmenuBuilder::new(handle, "文件")
                .item(&MenuItemBuilder::new("新建文件").id("new_file").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("打开文件").id("open_file").build(handle)?)
                .item(&MenuItemBuilder::new("打开文件夹").id("open_folder").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("保存").id("save").build(handle)?)
                .item(&MenuItemBuilder::new("另存为").id("save_as").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("关闭文件").id("close_file").build(handle)?)
                .item(&MenuItemBuilder::new("最近打开").id("recent_files").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("退出").id("quit").accelerator("CmdOrCtrl+Q").build(handle)?)
                .build()?;

            let edit_menu = SubmenuBuilder::new(handle, "编辑")
                .undo_with_text("撤销")
                .redo_with_text("重做")
                .separator()
                .cut_with_text("剪切")
                .copy_with_text("复制")
                .paste_with_text("粘贴")
                .select_all_with_text("全选")
                .separator()
                .item(&MenuItemBuilder::new("查找").id("find").accelerator("CmdOrCtrl+F").build(handle)?)
                .item(&MenuItemBuilder::new("替换").id("replace").accelerator("CmdOrCtrl+H").build(handle)?)
                .item(&MenuItemBuilder::new("命令面板").id("command_palette").accelerator("CmdOrCtrl+Shift+P").build(handle)?)
                .build()?;

            let view_menu = SubmenuBuilder::new(handle, "视图")
                .item(&MenuItemBuilder::new("编辑模式").id("view_edit").build(handle)?)
                .item(&MenuItemBuilder::new("预览模式").id("view_preview").build(handle)?)
                .item(&MenuItemBuilder::new("双栏模式").id("view_split").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("显示 / 隐藏侧边栏").id("toggle_sidebar").build(handle)?)
                .item(&MenuItemBuilder::new("显示 / 隐藏大纲").id("toggle_outline").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("放大").id("zoom_in").build(handle)?)
                .item(&MenuItemBuilder::new("缩小").id("zoom_out").build(handle)?)
                .item(&MenuItemBuilder::new("重置缩放").id("reset_zoom").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("浅色主题").id("theme_light").build(handle)?)
                .item(&MenuItemBuilder::new("深色主题").id("theme_dark").build(handle)?)
                .item(&MenuItemBuilder::new("跟随系统").id("theme_system").build(handle)?)
                .build()?;

            let insert_menu = SubmenuBuilder::new(handle, "插入")
                .item(&MenuItemBuilder::new("插入图片").id("insert_image").build(handle)?)
                .item(&MenuItemBuilder::new("插入链接").id("insert_link").build(handle)?)
                .item(&MenuItemBuilder::new("插入表格").id("insert_table").build(handle)?)
                .item(&MenuItemBuilder::new("插入代码块").id("insert_code").build(handle)?)
                .item(&MenuItemBuilder::new("插入分割线").id("insert_hr").build(handle)?)
                .item(&MenuItemBuilder::new("插入任务列表").id("insert_task").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("插入当前日期").id("insert_date").build(handle)?)
                .build()?;

            let export_menu = SubmenuBuilder::new(handle, "导出")
                .item(&MenuItemBuilder::new("导出为 PDF").id("export_pdf").build(handle)?)
                .item(&MenuItemBuilder::new("导出为 HTML").id("export_html").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("导出设置").id("export_settings").build(handle)?)
                .build()?;

            let window_menu = SubmenuBuilder::new(handle, "窗口")
                .item(&MenuItemBuilder::new("最小化").id("minimize").build(handle)?)
                .item(&MenuItemBuilder::new("最大化").id("maximize").build(handle)?)
                .item(&MenuItemBuilder::new("关闭窗口").id("close_window").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("切换上一个标签").id("prev_tab").build(handle)?)
                .item(&MenuItemBuilder::new("切换下一个标签").id("next_tab").build(handle)?)
                .build()?;

            let help_menu = SubmenuBuilder::new(handle, "帮助")
                .item(&MenuItemBuilder::new("Markdown 语法帮助").id("markdown_help").build(handle)?)
                .item(&MenuItemBuilder::new("快捷键说明").id("shortcut_help").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("检查更新").id("check_update").build(handle)?)
                .separator()
                .item(&MenuItemBuilder::new("关于 Orcha Writer").id("about").build(handle)?)
                .build()?;

            let menu = MenuBuilder::new(handle)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&insert_menu)
                .item(&export_menu)
                .item(&window_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            // Window-level file drop handler
            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            window.on_webview_event(move |event| {
                if let WebviewEvent::DragDrop(DragDropEvent::Drop { paths, position: _ }) = event {
                    let md_paths: Vec<String> = paths
                        .iter()
                        .filter(|p| p.extension().map(|e| e == "md").unwrap_or(false))
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    if !md_paths.is_empty() {
                        window_clone.emit("files-dropped", md_paths).ok();
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
                "open_file" => { window.emit("menu-action", "open_file").ok(); }
                "open_folder" => { window.emit("menu-action", "open_folder").ok(); }
                "save" => { window.emit("menu-action", "save").ok(); }
                "save_as" => { window.emit("menu-action", "save_as").ok(); }
                "close_file" => { window.emit("menu-action", "close_file").ok(); }
                "recent_files" => { window.emit("menu-action", "recent_files").ok(); }
                "quit" => { app.exit(0); }
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
                        .filter(|path| path.exists() && path.is_file() && is_markdown_file(path))
                        .map(|path| path.to_string_lossy().to_string())
                        .collect();
                    push_and_emit_open_files(_app_handle, paths);
                }
            }
        });
}
