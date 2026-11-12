use super::preview::extension;
use super::*;

pub(super) fn model_preview_note(name: String, message: &str) -> Preview {
    Preview {
        name,
        kind: "note".into(),
        content: Some(message.into()),
    }
}

pub(super) fn is_model(ext: &str) -> bool {
    matches!(ext, "obj" | "gltf" | "glb" | "ydr" | "ydd" | "yft")
}

pub(super) fn is_gtav_model(ext: &str) -> bool {
    matches!(ext, "ydr" | "ydd" | "yft")
}

pub(super) fn render_gtav_preview(
    name: &str,
    extension: &str,
    bytes: &[u8],
    texture_dictionary: Option<&[u8]>,
    drawable_index: Option<usize>,
) -> Result<Preview, String> {
    let content = crate::gui::model_preview::render_gtav_model(
        bytes,
        texture_dictionary,
        extension,
        drawable_index,
    )?;
    Ok(Preview {
        name: name.to_owned(),
        kind: "model".into(),
        content: Some(content),
    })
}

pub(super) fn generic_model_preview(
    name: &str,
    extension: &str,
    bytes: &[u8],
    assets: Vec<ModelAsset>,
) -> Result<Preview, String> {
    if bytes.len() > MODEL_PREVIEW_LIMIT {
        return Ok(model_preview_note(
            name.to_owned(),
            "Model preview is limited to 32 MiB.",
        ));
    }
    let content = serde_json::to_string(&GenericModelPayload {
        format: extension.into(),
        data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes),
        assets,
    })
    .map_err(|error| format!("Could not prepare model preview: {error}"))?;
    Ok(Preview {
        name: name.into(),
        kind: "model".into(),
        content: Some(content),
    })
}

pub(super) fn read_loose_texture_dictionary(file: &Path, root: &Path) -> Option<Vec<u8>> {
    let mut texture_path = file.to_path_buf();
    texture_path.set_extension("ytd");
    let texture_path = texture_path.canonicalize().ok()?;
    if !texture_path.starts_with(root)
        || texture_path.parent() != file.parent()
        || std::fs::metadata(&texture_path).ok()?.len() > MODEL_ASSET_LIMIT as u64
    {
        return None;
    }
    let bytes = std::fs::read(texture_path).ok()?;
    (bytes.len() <= MODEL_ASSET_LIMIT).then_some(bytes)
}

pub(super) fn read_archive_texture_dictionary(rpf: &Rpf, model_index: usize) -> Option<Vec<u8>> {
    let model = rpf.entries.get(model_index)?;
    let name = model.name.rsplit_once('.').map(|(stem, _)| stem)?;
    let texture_name = format!("{name}.ytd");
    let texture_index = find_archive_sibling(rpf, model_index, &texture_name)?;
    let texture = rpf.entries.get(texture_index)?;
    if texture.size() as usize > MODEL_ASSET_LIMIT {
        return None;
    }
    let bytes = rpf.read_file(texture_index).ok()?;
    (bytes.len() <= MODEL_ASSET_LIMIT).then_some(bytes)
}

pub(super) fn collect_loose_model_assets(
    model_path: &Path,
    root: &Path,
    model_extension: &str,
    model_bytes: &[u8],
) -> Result<Vec<ModelAsset>, String> {
    let mut assets = Vec::new();
    let mut total_size = 0usize;
    let mut pending = model_asset_references(model_extension, model_bytes)
        .into_iter()
        .map(|reference| (String::new(), reference))
        .collect::<Vec<_>>();
    let mut visited = std::collections::BTreeSet::new();
    let parent = model_path
        .parent()
        .ok_or("The selected model has no parent directory.")?;

    while let Some((base, reference)) = pending.pop() {
        let Some(path) = resolve_model_reference(&base, &reference) else {
            continue;
        };
        if !visited.insert(path.clone()) || assets.len() >= MODEL_ASSET_COUNT_LIMIT {
            continue;
        }
        let candidate = parent.join(Path::new(&path));
        let Ok(candidate) = candidate.canonicalize() else {
            continue;
        };
        if !candidate.starts_with(root) {
            continue;
        }
        let Ok(metadata) = std::fs::metadata(&candidate) else {
            continue;
        };
        let size = metadata.len() as usize;
        if !metadata.is_file()
            || size > MODEL_ASSET_LIMIT
            || total_size.saturating_add(size) > MODEL_ASSET_BUNDLE_LIMIT
        {
            continue;
        }
        let Ok(bytes) = std::fs::read(&candidate) else {
            continue;
        };
        if bytes.len() > MODEL_ASSET_LIMIT
            || total_size.saturating_add(bytes.len()) > MODEL_ASSET_BUNDLE_LIMIT
        {
            continue;
        }
        total_size += bytes.len();
        let asset_extension = extension(&path);
        if asset_extension == "mtl" {
            pending.extend(
                model_asset_references("mtl", &bytes)
                    .into_iter()
                    .map(|reference| (path.clone(), reference)),
            );
        }
        assets.push(ModelAsset {
            path,
            data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes),
        });
    }
    Ok(assets)
}

pub(super) fn collect_archive_model_assets(
    rpf: &Rpf,
    model_index: usize,
    model_extension: &str,
    model_bytes: &[u8],
) -> Result<Vec<ModelAsset>, String> {
    let mut assets = Vec::new();
    let mut total_size = 0usize;
    let mut pending = model_asset_references(model_extension, model_bytes)
        .into_iter()
        .map(|reference| (String::new(), reference))
        .collect::<Vec<_>>();
    let mut visited = std::collections::BTreeSet::new();

    while let Some((base, reference)) = pending.pop() {
        let Some(path) = resolve_model_reference(&base, &reference) else {
            continue;
        };
        if !visited.insert(path.clone()) || assets.len() >= MODEL_ASSET_COUNT_LIMIT {
            continue;
        }
        let Some(asset_index) = resolve_archive_model_asset(rpf, model_index, &path) else {
            continue;
        };
        let Some(entry) = rpf.entries.get(asset_index) else {
            continue;
        };
        let size = entry.size() as usize;
        if size > MODEL_ASSET_LIMIT || total_size.saturating_add(size) > MODEL_ASSET_BUNDLE_LIMIT {
            continue;
        }
        let Ok(bytes) = rpf.read_file(asset_index) else {
            continue;
        };
        if bytes.len() > MODEL_ASSET_LIMIT
            || total_size.saturating_add(bytes.len()) > MODEL_ASSET_BUNDLE_LIMIT
        {
            continue;
        }
        total_size += bytes.len();
        if extension(&path) == "mtl" {
            pending.extend(
                model_asset_references("mtl", &bytes)
                    .into_iter()
                    .map(|reference| (path.clone(), reference)),
            );
        }
        assets.push(ModelAsset {
            path,
            data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes),
        });
    }
    Ok(assets)
}

pub(super) fn resolve_model_reference(base: &str, reference: &str) -> Option<String> {
    if reference.is_empty()
        || reference.starts_with("data:")
        || reference.starts_with("//")
        || reference.contains("://")
        || reference
            .chars()
            .any(|character| matches!(character, '?' | '#' | '\\' | ':' | '\0'))
    {
        return None;
    }
    let decoded = percent_decode_path(reference)?;
    if decoded.starts_with('/')
        || decoded.starts_with("//")
        || decoded
            .chars()
            .any(|character| matches!(character, '?' | '#' | '\\' | ':' | '\0'))
    {
        return None;
    }
    let parent = base
        .rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("");
    let joined = if parent.is_empty() {
        decoded
    } else {
        format!("{parent}/{decoded}")
    };
    let parts = joined.split('/').collect::<Vec<_>>();
    if parts.is_empty() || parts.iter().any(|part| part.is_empty() || *part == "..") {
        return None;
    }
    let normalized = parts
        .into_iter()
        .filter(|part| *part != ".")
        .collect::<Vec<_>>();
    (!normalized.is_empty()).then(|| normalized.join("/"))
}

fn percent_decode_path(value: &str) -> Option<String> {
    let input = value.as_bytes();
    let mut decoded = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            let high = *input.get(index + 1)?;
            let low = *input.get(index + 2)?;
            decoded.push((hex_nibble(high)? << 4) | hex_nibble(low)?);
            index += 3;
        } else {
            decoded.push(input[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

pub(super) fn model_asset_references(extension: &str, bytes: &[u8]) -> Vec<String> {
    match extension {
        "obj" => String::from_utf8_lossy(bytes)
            .lines()
            .filter_map(|line| line.trim().strip_prefix("mtllib "))
            .flat_map(str::split_whitespace)
            .take(MODEL_ASSET_COUNT_LIMIT)
            .map(str::to_owned)
            .collect(),
        "mtl" => String::from_utf8_lossy(bytes)
            .lines()
            .filter_map(|line| {
                let mut fields = line.split_whitespace();
                let command = fields.next()?.to_ascii_lowercase();
                matches!(
                    command.as_str(),
                    "map_ka"
                        | "map_kd"
                        | "map_ks"
                        | "map_ns"
                        | "map_d"
                        | "map_bump"
                        | "bump"
                        | "norm"
                        | "disp"
                        | "decal"
                        | "refl"
                )
                .then(|| fields.last().map(str::to_owned))
                .flatten()
            })
            .take(MODEL_ASSET_COUNT_LIMIT)
            .collect(),
        "gltf" | "glb" => gltf_asset_references(extension, bytes),
        _ => Vec::new(),
    }
}

fn gltf_asset_references(extension: &str, bytes: &[u8]) -> Vec<String> {
    let json_bytes = if extension == "glb" {
        glb_json_chunk(bytes)
    } else {
        Some(bytes)
    };
    let Some(json_bytes) = json_bytes else {
        return Vec::new();
    };
    let Ok(document) = serde_json::from_slice::<serde_json::Value>(json_bytes) else {
        return Vec::new();
    };
    ["buffers", "images"]
        .into_iter()
        .flat_map(|key| {
            document
                .get(key)
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|entry| entry.get("uri").and_then(serde_json::Value::as_str))
        .filter(|uri| !uri.starts_with("data:"))
        .take(MODEL_ASSET_COUNT_LIMIT)
        .map(str::to_owned)
        .collect()
}

fn glb_json_chunk(bytes: &[u8]) -> Option<&[u8]> {
    if bytes.get(0..4)? != b"glTF" || u32::from_le_bytes(bytes.get(4..8)?.try_into().ok()?) != 2 {
        return None;
    }
    let declared_len = u32::from_le_bytes(bytes.get(8..12)?.try_into().ok()?) as usize;
    if declared_len > bytes.len() || declared_len < 12 {
        return None;
    }
    let mut offset = 12usize;
    while offset.checked_add(8)? <= declared_len {
        let size = u32::from_le_bytes(bytes.get(offset..offset + 4)?.try_into().ok()?) as usize;
        let chunk_type = u32::from_le_bytes(bytes.get(offset + 4..offset + 8)?.try_into().ok()?);
        let end = offset.checked_add(8)?.checked_add(size)?;
        if end > declared_len {
            return None;
        }
        if chunk_type == 0x4E4F534A {
            return bytes.get(offset + 8..end);
        }
        offset = end;
    }
    None
}

fn archive_parent_directory(rpf: &Rpf, entry_index: usize) -> Option<usize> {
    rpf.entries.iter().enumerate().find_map(|(index, entry)| {
        let Kind::Dir { kids } = &entry.kind else {
            return None;
        };
        kids.contains(&(entry_index as u32)).then_some(index)
    })
}

fn find_archive_sibling(rpf: &Rpf, entry_index: usize, name: &str) -> Option<usize> {
    let parent = archive_parent_directory(rpf, entry_index)?;
    let Kind::Dir { kids } = &rpf.entries.get(parent)?.kind else {
        return None;
    };
    kids.iter().map(|index| *index as usize).find(|index| {
        rpf.entries
            .get(*index)
            .is_some_and(|entry| !entry.is_dir() && entry.name.eq_ignore_ascii_case(name))
    })
}

fn resolve_archive_model_asset(rpf: &Rpf, model_index: usize, path: &str) -> Option<usize> {
    let mut directory = archive_parent_directory(rpf, model_index)?;
    let parts = path.split('/').collect::<Vec<_>>();
    for (part_index, part) in parts.iter().enumerate() {
        let Kind::Dir { kids } = &rpf.entries.get(directory)?.kind else {
            return None;
        };
        let child = kids.iter().map(|index| *index as usize).find(|index| {
            rpf.entries
                .get(*index)
                .is_some_and(|entry| entry.name.eq_ignore_ascii_case(part))
        })?;
        if part_index + 1 == parts.len() {
            return (!rpf.entries.get(child)?.is_dir()).then_some(child);
        }
        directory = child;
    }
    None
}
