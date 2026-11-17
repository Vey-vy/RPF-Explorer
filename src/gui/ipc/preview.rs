use super::model_assets::{
    collect_archive_model_assets, collect_loose_model_assets, generic_model_preview, is_gtav_model,
    is_model, model_preview_note, read_archive_texture_dictionary, read_loose_texture_dictionary,
    render_gtav_preview,
};
use super::*;
use tauri::State;

#[tauri::command]
pub fn preview_game_file(
    state: State<'_, ExplorerState>,
    relative_path: String,
    drawable_index: Option<usize>,
) -> Result<Preview, String> {
    let root_path = {
        let data = state
            .inner
            .lock()
            .map_err(|_| "Application state is unavailable")?;
        if data.game_id.is_none() {
            return Err("No game folder is selected.".into());
        }
        data.root.clone()
    };
    let relative_path = Path::new(&relative_path);
    if relative_path.as_os_str().is_empty()
        || relative_path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("The requested game file path is invalid.".into());
    }

    let root = root_path
        .canonicalize()
        .map_err(|error| format!("Could not access the selected game folder: {error}"))?;
    let file = root
        .join(relative_path)
        .canonicalize()
        .map_err(|error| format!("Could not access game file: {error}"))?;
    if !file.starts_with(&root) {
        return Err("The requested file is outside the selected game folder.".into());
    }
    let metadata = std::fs::metadata(&file)
        .map_err(|error| format!("Could not inspect game file: {error}"))?;
    if !metadata.is_file() {
        return Err("The requested path is not a file.".into());
    }

    let name = file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("The selected game file has an invalid name.")?
        .to_owned();
    let extension = extension(&name);
    if matches!(extension.as_str(), "ytd" | "wtd") {
        if metadata.len() > PREVIEW_LIMIT as u64 {
            return Ok(Preview {
                name,
                kind: "note".into(),
                content: Some(format!(
                    "{} preview is limited to 64 MiB.",
                    extension.to_ascii_uppercase()
                )),
            });
        }
        let bytes =
            std::fs::read(&file).map_err(|error| format!("Could not read game file: {error}"))?;
        return if extension == "ytd" {
            texture_preview::preview_ytd(name, &bytes)
        } else {
            texture_preview::preview_wtd(name, &bytes)
        };
    }
    if is_model(&extension) {
        if metadata.len() > MODEL_PREVIEW_LIMIT as u64 {
            return Ok(model_preview_note(
                name,
                "Model preview is limited to 32 MiB.",
            ));
        }
        let bytes =
            std::fs::read(&file).map_err(|error| format!("Could not read game file: {error}"))?;
        if bytes.len() > MODEL_PREVIEW_LIMIT {
            return Ok(model_preview_note(
                name,
                "Model preview is limited to 32 MiB.",
            ));
        }
        if is_gtav_model(&extension) {
            let texture_dictionary = read_loose_texture_dictionary(&file, &root);
            return render_gtav_preview(
                &name,
                &extension,
                &bytes,
                texture_dictionary.as_deref(),
                drawable_index,
            );
        }

        let assets = collect_loose_model_assets(&file, &root, &extension, &bytes)?;
        return generic_model_preview(&name, &extension, &bytes, assets);
    }
    if is_text(&extension) {
        if metadata.len() > TEXT_PREVIEW_LIMIT as u64 {
            return Ok(Preview {
                name,
                kind: "note".into(),
                content: Some("Text preview is limited to 2 MiB.".into()),
            });
        }
        let bytes =
            std::fs::read(&file).map_err(|error| format!("Could not read game file: {error}"))?;
        let mut text = String::from_utf8_lossy(&bytes).into_owned();
        if text.chars().count() > 12_000 {
            text = text.chars().take(12_000).collect::<String>() + "\n… Preview truncated";
        }
        return Ok(Preview {
            name,
            kind: "text".into(),
            content: Some(text),
        });
    }
    if is_image(&extension) {
        if metadata.len() > PREVIEW_LIMIT as u64 {
            return Ok(Preview {
                name,
                kind: "note".into(),
                content: Some("Image preview is limited to 64 MiB.".into()),
            });
        }
        let bytes =
            std::fs::read(&file).map_err(|error| format!("Could not read game file: {error}"))?;
        let (mime, preview_bytes) = encode_image(&name, &bytes)?;
        return Ok(Preview {
            name,
            kind: "image".into(),
            content: Some(format!(
                "data:image/{};base64,{}",
                mime,
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, preview_bytes)
            )),
        });
    }

    Ok(Preview {
        name,
        kind: "note".into(),
        content: Some("No preview is available for this file type.".into()),
    })
}

#[tauri::command]
pub fn preview_entry(
    state: State<'_, ExplorerState>,
    archive_index: usize,
    entry_index: usize,
    drawable_index: Option<usize>,
) -> Result<Preview, String> {
    let data = state
        .inner
        .lock()
        .map_err(|_| "Application state is unavailable")?;
    let (rpf, entry) = get_entry(&data, archive_index, entry_index)?;
    if entry.is_dir() {
        return Err("Folders do not have a preview.".into());
    }
    let name = entry.name.clone();
    let extension = extension(&name);
    if matches!(extension.as_str(), "ytd" | "wtd") {
        if entry.size() as usize > PREVIEW_LIMIT {
            return Ok(Preview {
                name,
                kind: "note".into(),
                content: Some(format!(
                    "{} preview is limited to 64 MiB.",
                    extension.to_ascii_uppercase()
                )),
            });
        }
        let bytes = rpf
            .read_file(entry_index)
            .map_err(|error| format!("Could not read texture dictionary: {error}"))?;
        return if extension == "ytd" {
            texture_preview::preview_ytd(name, &bytes)
        } else {
            texture_preview::preview_wtd(name, &bytes)
        };
    }
    if is_model(&extension) {
        if entry.size() as usize > MODEL_PREVIEW_LIMIT {
            return Ok(model_preview_note(
                name,
                "Model preview is limited to 32 MiB.",
            ));
        }
        let bytes = rpf
            .read_file(entry_index)
            .map_err(|error| error.to_string())?;
        if bytes.len() > MODEL_PREVIEW_LIMIT {
            return Ok(model_preview_note(
                name,
                "Model preview is limited to 32 MiB.",
            ));
        }
        if is_gtav_model(&extension) {
            let texture_dictionary = read_archive_texture_dictionary(&rpf, entry_index);
            return render_gtav_preview(
                &name,
                &extension,
                &bytes,
                texture_dictionary.as_deref(),
                drawable_index,
            );
        }
        let assets = collect_archive_model_assets(&rpf, entry_index, &extension, &bytes)?;
        return generic_model_preview(&name, &extension, &bytes, assets);
    }
    if is_text(&extension) {
        if entry.size() as usize > TEXT_PREVIEW_LIMIT {
            return Ok(Preview {
                name,
                kind: "note".into(),
                content: Some("Text preview is limited to 2 MiB.".into()),
            });
        }
        let bytes = rpf
            .read_file(entry_index)
            .map_err(|error| error.to_string())?;
        let mut text = String::from_utf8_lossy(&bytes).into_owned();
        if text.chars().count() > 12_000 {
            text = text.chars().take(12_000).collect::<String>() + "\n… Preview truncated";
        }
        return Ok(Preview {
            name,
            kind: "text".into(),
            content: Some(text),
        });
    }
    if is_image(&extension) {
        if entry.size() as usize > PREVIEW_LIMIT {
            return Ok(Preview {
                name,
                kind: "note".into(),
                content: Some("Image preview is limited to 64 MiB.".into()),
            });
        }
        let bytes = rpf
            .read_file(entry_index)
            .map_err(|error| error.to_string())?;
        let (mime, preview_bytes) = encode_image(&name, &bytes)?;
        return Ok(Preview {
            name,
            kind: "image".into(),
            content: Some(format!(
                "data:image/{};base64,{}",
                mime,
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, preview_bytes)
            )),
        });
    }
    let resource = matches!(entry.kind, Kind::File { resource: true, .. });
    let note = if resource
        || matches!(
            extension.as_str(),
            "wdr" | "wft" | "wtd" | "ydr" | "ydd" | "yft"
        ) {
        "3D/resource preview is not available. Extract the original file to inspect it with a compatible tool."
    } else {
        "No preview is available for this file type. You can still extract the original file."
    };
    Ok(Preview {
        name,
        kind: "note".into(),
        content: Some(note.into()),
    })
}

pub(super) fn extension(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_text(ext: &str) -> bool {
    matches!(
        ext,
        "csv"
            | "xml"
            | "txt"
            | "dat"
            | "ide"
            | "ipl"
            | "cfg"
            | "meta"
            | "ini"
            | "fx"
            | "lua"
            | "json"
    )
}

fn is_image(ext: &str) -> bool {
    matches!(ext, "dds" | "png" | "jpg" | "jpeg")
}

fn encode_image(name: &str, bytes: &[u8]) -> Result<(&'static str, Vec<u8>), String> {
    if bytes.len() > PREVIEW_LIMIT {
        return Err("Image preview is limited to 64 MiB.".into());
    }
    if extension(name) == "dds" {
        let dds = ddsfile::Dds::read(&mut std::io::Cursor::new(bytes))
            .map_err(|error| format!("Invalid or unreadable DDS: {error}"))?;
        if dds.get_width() > 8192
            || dds.get_height() > 8192
            || u64::from(dds.get_width()) * u64::from(dds.get_height()) > 16 * 1024 * 1024
        {
            return Err("Unsupported image dimensions.".into());
        }
        let image = image_dds::image_from_dds(&dds, 0)
            .map_err(|error| format!("Could not decode DDS: {error}"))?;
        let mut output = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut output, image::ImageFormat::Png)
            .map_err(|error| format!("Could not encode DDS preview: {error}"))?;
        return Ok(("png", output.into_inner()));
    } else {
        let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|error| error.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(PREVIEW_LIMIT as u64);
        reader.limits(limits);
        let decoded = reader
            .decode()
            .map_err(|error| format!("Could not decode image: {error}"))?;
        let (width, height) = (decoded.width(), decoded.height());
        if width == 0
            || height == 0
            || width > 8192
            || height > 8192
            || u64::from(width) * u64::from(height) > 16 * 1024 * 1024
        {
            return Err(format!("Unsupported image dimensions: {width} × {height}."));
        }
    }
    let mime = match extension(name).as_str() {
        "jpg" | "jpeg" => "jpeg",
        "png" => "png",
        _ => return Err("Unsupported image format.".into()),
    };
    Ok((mime, bytes.to_vec()))
}
