use super::*;
use flate2::read::{DeflateDecoder, ZlibDecoder};
use image::ImageFormat;
use serde::Serialize;
use std::io::{Cursor, Read};

const YTD_TEXTURE_COUNT_LIMIT: usize = 128;
const YTD_TEXTURE_EDGE_LIMIT: u16 = 4096;
const YTD_TEXTURE_PIXEL_LIMIT: u64 = 16 * 1024 * 1024;
const YTD_PREVIEW_DATA_LIMIT: usize = 24 * 1024 * 1024;
const WTD_DECOMPRESSED_LIMIT: usize = 128 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextureDictionaryContent {
    textures: Vec<TextureImage>,
    total_textures: usize,
    omitted_textures: usize,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextureImage {
    name: String,
    width: u16,
    height: u16,
    format: String,
    levels: u8,
    image_data: String,
}

pub(super) fn preview_ytd(name: String, bytes: &[u8]) -> Result<Preview, String> {
    if bytes.len() > PREVIEW_LIMIT {
        return Ok(Preview {
            name,
            kind: "note".into(),
            content: Some("YTD preview is limited to 64 MiB.".into()),
        });
    }

    let decoded = rage_formats::parse_ytd(bytes)
        .map_err(|error| format!("Could not decode YTD texture dictionary: {error:#}"))?;
    let total_textures = decoded.len();
    preview_textures(name, "YTD", decoded, total_textures)
}

pub(super) fn preview_wtd(name: String, bytes: &[u8]) -> Result<Preview, String> {
    if bytes.len() > PREVIEW_LIMIT {
        return Ok(Preview {
            name,
            kind: "note".into(),
            content: Some("WTD preview is limited to 64 MiB.".into()),
        });
    }

    let (decoded, total_textures) = parse_wtd(bytes)?;
    preview_textures(name, "WTD", decoded, total_textures)
}

fn preview_textures(
    name: String,
    dictionary_type: &str,
    decoded: Vec<rage_formats::YtdTexture>,
    total_textures: usize,
) -> Result<Preview, String> {
    if total_textures == 0 {
        return Ok(Preview {
            name,
            kind: "note".into(),
            content: Some(format!("This {dictionary_type} contains no textures.")),
        });
    }

    let mut textures = Vec::new();
    let mut omitted_textures = total_textures.saturating_sub(decoded.len());
    let mut total_pixels = 0u64;
    let mut total_image_data = 0usize;
    let mut warnings = Vec::new();

    for (index, texture) in decoded.into_iter().enumerate() {
        if index >= YTD_TEXTURE_COUNT_LIMIT {
            omitted_textures += 1;
            continue;
        }

        let pixels = u64::from(texture.width) * u64::from(texture.height);
        if texture.width == 0
            || texture.height == 0
            || texture.width > YTD_TEXTURE_EDGE_LIMIT
            || texture.height > YTD_TEXTURE_EDGE_LIMIT
            || total_pixels.saturating_add(pixels) > YTD_TEXTURE_PIXEL_LIMIT
        {
            omitted_textures += 1;
            continue;
        }

        let rgba = match rage_formats::decompress_texture(&texture) {
            Ok(rgba) => rgba,
            Err(error) => {
                omitted_textures += 1;
                if warnings.len() < 8 {
                    warnings.push(format!("{}: {error:#}", texture.name));
                }
                continue;
            }
        };
        let Some(image) =
            image::RgbaImage::from_raw(u32::from(texture.width), u32::from(texture.height), rgba)
        else {
            omitted_textures += 1;
            if warnings.len() < 8 {
                warnings.push(format!(
                    "{}: decoded pixels do not match the image dimensions",
                    texture.name
                ));
            }
            continue;
        };

        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut png, ImageFormat::Png)
            .map_err(|error| format!("Could not encode texture preview: {error}"))?;
        let image_data =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, png.into_inner());
        if total_image_data.saturating_add(image_data.len()) > YTD_PREVIEW_DATA_LIMIT {
            omitted_textures += 1;
            if warnings.len() < 8 {
                warnings.push("Preview data limit reached.".into());
            }
            continue;
        }

        total_pixels += pixels;
        total_image_data += image_data.len();
        textures.push(TextureImage {
            name: texture.name,
            width: texture.width,
            height: texture.height,
            format: texture.format.to_string(),
            levels: texture.levels,
            image_data,
        });
    }

    let content = serde_json::to_string(&TextureDictionaryContent {
        textures,
        total_textures,
        omitted_textures,
        warnings,
    })
    .map_err(|error| format!("Could not prepare texture dictionary preview: {error}"))?;

    Ok(Preview {
        name,
        kind: "texture-dictionary".into(),
        content: Some(content),
    })
}

fn parse_wtd(bytes: &[u8]) -> Result<(Vec<rage_formats::YtdTexture>, usize), String> {
    if bytes.len() < 12 {
        return Err("WTD resource header is truncated.".into());
    }
    let magic = u32::from_le_bytes(bytes[..4].try_into().unwrap());
    if magic != 0x0543_5352 {
        return Err(format!(
            "Unsupported WTD resource version (header {magic:#010x}); this reader supports RSC5 WTD dictionaries."
        ));
    }
    let flags = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
    let system_size = ((flags & 0x7ff) as usize) << (((flags >> 11) & 0xf) as usize + 8);
    let graphics_size = (((flags >> 15) & 0x7ff) as usize) << (((flags >> 26) & 0xf) as usize + 8);
    let expected_size = system_size
        .checked_add(graphics_size)
        .filter(|size| *size <= WTD_DECOMPRESSED_LIMIT)
        .ok_or("WTD resource exceeds the 128 MiB decompression limit.")?;

    let compressed = &bytes[12..];
    let mut expanded = Vec::with_capacity(expected_size);
    if compressed.first() == Some(&0x78) {
        ZlibDecoder::new(compressed)
            .take(expected_size as u64 + 1)
            .read_to_end(&mut expanded)
    } else {
        DeflateDecoder::new(compressed)
            .take(expected_size as u64 + 1)
            .read_to_end(&mut expanded)
    }
    .map_err(|error| format!("Could not decompress WTD resource: {error}"))?;
    if expanded.len() < expected_size {
        return Err(format!(
            "WTD resource is truncated: decompressed {} of {expected_size} bytes.",
            expanded.len()
        ));
    }
    expanded.truncate(expected_size);
    let graphics = expanded.split_off(system_size);
    parse_wtd_dictionary(&expanded, &graphics)
}

fn parse_wtd_dictionary(
    system: &[u8],
    graphics: &[u8],
) -> Result<(Vec<rage_formats::YtdTexture>, usize), String> {
    const ROOT: u32 = 0x5000_0000;
    let hashes_pointer = read_system_u32(system, ROOT, 0x10)?;
    let textures_pointer = read_system_u32(system, ROOT, 0x18)?;
    let count = read_system_u16(system, ROOT, 0x1c)? as usize;
    if count == 0 {
        return Ok((Vec::new(), 0));
    }
    let hashes_offset = system_offset(system, hashes_pointer)?;
    let textures_offset = system_offset(system, textures_pointer)?;
    let mut textures = Vec::with_capacity(count.min(YTD_TEXTURE_COUNT_LIMIT));

    for index in 0..count.min(YTD_TEXTURE_COUNT_LIMIT) {
        let hash = read_u32(system, hashes_offset + index * 4)?;
        let texture_pointer = read_u32(system, textures_offset + index * 4)?;
        let name_pointer = read_system_u32(system, texture_pointer, 0x14)?;
        let name = if name_pointer == 0 {
            format!("hash_{hash:08x}")
        } else {
            let raw_name = read_system_string(system, name_pointer)?;
            let name = raw_name.strip_prefix("pack:/").unwrap_or(&raw_name);
            name.strip_suffix(".dds").unwrap_or(name).to_owned()
        };
        let width = read_system_u16(system, texture_pointer, 0x1c)?;
        let height = read_system_u16(system, texture_pointer, 0x1e)?;
        let format_value = read_system_u32(system, texture_pointer, 0x20)?;
        let format = rage_formats::TextureFormat::from_u32(format_value);
        if format == rage_formats::TextureFormat::Unknown {
            return Err(format!(
                "WTD texture {name} has unsupported format {format_value:#010x}."
            ));
        }
        let stride = read_system_u16(system, texture_pointer, 0x26)?;
        let mut levels = read_system_u8(system, texture_pointer, 0x27)?.max(1);
        let pixel_pointer_48 = read_system_u32(system, texture_pointer, 0x48)?;
        let pixel_pointer_44 = read_system_u32(system, texture_pointer, 0x44)?;
        let pixel_pointer = if pixel_pointer_48 >> 28 == 6 {
            pixel_pointer_48
        } else if pixel_pointer_44 >> 28 == 6 {
            pixel_pointer_44
        } else {
            continue;
        };
        let pixel_offset = graphics_offset(graphics, pixel_pointer)?;
        let available = graphics.len().saturating_sub(pixel_offset);
        while levels > 1 && rage_formats::mip_chain_size(format, width, height, levels) > available
        {
            levels -= 1;
        }
        let data_size = rage_formats::mip_chain_size(format, width, height, levels);
        let end = pixel_offset
            .checked_add(data_size)
            .filter(|end| *end <= graphics.len())
            .ok_or_else(|| format!("WTD texture {name} pixel data is truncated."))?;

        textures.push(rage_formats::YtdTexture {
            name,
            name_hash: hash,
            width,
            height,
            depth: 1,
            format,
            levels,
            stride,
            pixel_data: graphics[pixel_offset..end].to_vec(),
        });
    }

    Ok((textures, count))
}

fn system_offset(system: &[u8], pointer: u32) -> Result<usize, String> {
    if pointer >> 28 != 5 {
        return Err(format!("Invalid WTD system pointer {pointer:#010x}."));
    }
    let offset = (pointer & 0x0fff_ffff) as usize;
    if offset >= system.len() {
        return Err("WTD system pointer is outside its data segment.".into());
    }
    Ok(offset)
}

fn graphics_offset(graphics: &[u8], pointer: u32) -> Result<usize, String> {
    if pointer >> 28 != 6 {
        return Err(format!("Invalid WTD graphics pointer {pointer:#010x}."));
    }
    let offset = (pointer & 0x0fff_ffff) as usize;
    if offset >= graphics.len() {
        return Err("WTD graphics pointer is outside its data segment.".into());
    }
    Ok(offset)
}

fn read_u32(data: &[u8], offset: usize) -> Result<u32, String> {
    let bytes = data
        .get(offset..offset.saturating_add(4))
        .ok_or("WTD data is truncated.")?;
    Ok(u32::from_le_bytes(bytes.try_into().unwrap()))
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16, String> {
    let bytes = data
        .get(offset..offset.saturating_add(2))
        .ok_or("WTD data is truncated.")?;
    Ok(u16::from_le_bytes(bytes.try_into().unwrap()))
}

fn read_system_u32(system: &[u8], pointer: u32, field: usize) -> Result<u32, String> {
    let offset = system_offset(system, pointer)?
        .checked_add(field)
        .ok_or("WTD system offset overflow.")?;
    read_u32(system, offset)
}

fn read_system_u16(system: &[u8], pointer: u32, field: usize) -> Result<u16, String> {
    let offset = system_offset(system, pointer)?
        .checked_add(field)
        .ok_or("WTD system offset overflow.")?;
    read_u16(system, offset)
}

fn read_system_u8(system: &[u8], pointer: u32, field: usize) -> Result<u8, String> {
    let offset = system_offset(system, pointer)?
        .checked_add(field)
        .ok_or("WTD system offset overflow.")?;
    system
        .get(offset)
        .copied()
        .ok_or_else(|| "WTD data is truncated.".into())
}

fn read_system_string(system: &[u8], pointer: u32) -> Result<String, String> {
    let offset = system_offset(system, pointer)?;
    let bytes = system
        .get(offset..)
        .ok_or("WTD texture name is outside its data segment.")?;
    let end = bytes
        .iter()
        .take(1024)
        .position(|byte| *byte == 0)
        .ok_or("WTD texture name is not terminated.")?;
    Ok(String::from_utf8_lossy(&bytes[..end]).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write;

    #[test]
    fn previews_ytd_texture_pixels_as_png() {
        let format = rage_formats::TextureFormat::A8R8G8B8;
        let texture = rage_formats::YtdTexture {
            name: "test_diffuse".into(),
            name_hash: 0,
            width: 2,
            height: 1,
            depth: 1,
            format,
            levels: 1,
            stride: rage_formats::stride_for(format, 2, 1),
            pixel_data: vec![0, 0, 255, 255, 0, 255, 0, 255],
        };
        let bytes = rage_formats::serialize_ytd(&[texture]).unwrap();

        let preview = preview_ytd("sample.ytd".into(), &bytes).unwrap();
        assert_eq!(preview.kind, "texture-dictionary");
        let content: serde_json::Value =
            serde_json::from_str(preview.content.as_deref().unwrap()).unwrap();
        let textures = content["textures"].as_array().unwrap();
        assert_eq!(textures.len(), 1);
        assert_eq!(textures[0]["name"], "test_diffuse");
        assert_eq!(textures[0]["width"], 2);
        assert_eq!(textures[0]["height"], 1);

        let png = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            textures[0]["imageData"].as_str().unwrap(),
        )
        .unwrap();
        let image = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(image.dimensions(), (2, 1));
        assert_eq!(image.get_pixel(0, 0).0, [255, 0, 0, 255]);
    }

    #[test]
    fn previews_rsc5_wtd_texture_pixels_as_png() {
        let mut system = vec![0u8; 512];
        let mut graphics = vec![0u8; 512];
        system[0x10..0x14].copy_from_slice(&0x5000_0040u32.to_le_bytes());
        system[0x18..0x1c].copy_from_slice(&0x5000_0048u32.to_le_bytes());
        system[0x1c..0x1e].copy_from_slice(&1u16.to_le_bytes());
        system[0x40..0x44].copy_from_slice(&0x1234u32.to_le_bytes());
        system[0x48..0x4c].copy_from_slice(&0x5000_0060u32.to_le_bytes());

        let texture = 0x60;
        system[texture + 0x14..texture + 0x18].copy_from_slice(&0x5000_00c0u32.to_le_bytes());
        system[texture + 0x1c..texture + 0x1e].copy_from_slice(&2u16.to_le_bytes());
        system[texture + 0x1e..texture + 0x20].copy_from_slice(&1u16.to_le_bytes());
        system[texture + 0x20..texture + 0x24].copy_from_slice(&21u32.to_le_bytes());
        system[texture + 0x26..texture + 0x28].copy_from_slice(&8u16.to_le_bytes());
        system[texture + 0x28] = 1;
        system[texture + 0x48..texture + 0x4c].copy_from_slice(&0x6000_0000u32.to_le_bytes());
        system[0xc0..0xcb].copy_from_slice(b"weapon.dds\0");
        graphics[..8].copy_from_slice(&[0, 0, 255, 255, 0, 255, 0, 255]);

        let mut resource_body = system;
        resource_body.extend_from_slice(&graphics);
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&resource_body).unwrap();
        let compressed = encoder.finish().unwrap();
        let mut bytes = vec![0u8; 12];
        bytes[..4].copy_from_slice(&0x0543_5352u32.to_le_bytes());
        bytes[8..12].copy_from_slice(&((2u32) | (2u32 << 15)).to_le_bytes());
        bytes.extend_from_slice(&compressed);

        let preview = preview_wtd("weapon.wtd".into(), &bytes).unwrap();
        assert_eq!(preview.kind, "texture-dictionary");
        let content: serde_json::Value =
            serde_json::from_str(preview.content.as_deref().unwrap()).unwrap();
        let textures = content["textures"].as_array().unwrap();
        assert_eq!(textures.len(), 1);
        assert_eq!(textures[0]["name"], "weapon");
        let png = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            textures[0]["imageData"].as_str().unwrap(),
        )
        .unwrap();
        let image = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(image.dimensions(), (2, 1));
        assert_eq!(image.get_pixel(0, 0).0, [255, 0, 0, 255]);
    }
}
