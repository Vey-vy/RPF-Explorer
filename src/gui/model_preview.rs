use base64::Engine;
use image::ImageFormat;
use rage_formats::ydd::{parse_drawables, DrawableEntry, DrawableKind};
use rage_formats::yft::parse_yft;
use rage_render::render::{render_parts, Facing, RenderOptions, RenderPart, TextureSet, View};
use serde::Serialize;
use std::io::Cursor;

const VIEW_COUNT: usize = 12;
const VIEW_SIZE: u32 = 320;
const RENDERED_PREVIEW_LIMIT: usize = 20 * 1024 * 1024;
const MODEL_PREVIEW_LIMIT: usize = 32 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DrawableOption {
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderedView {
    azimuth: i16,
    image: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeModelPreview {
    renderer: &'static str,
    format: String,
    drawables: Vec<DrawableOption>,
    selected_drawable: usize,
    triangles: usize,
    geometries: usize,
    textures: usize,
    missing_textures: usize,
    views: Vec<RenderedView>,
}

pub(crate) fn render_gtav_model(
    bytes: &[u8],
    texture_dictionary: Option<&[u8]>,
    extension: &str,
    selected_drawable: Option<usize>,
) -> Result<String, String> {
    if bytes.len() > MODEL_PREVIEW_LIMIT {
        return Err("GTA V model preview is limited to 32 MiB.".into());
    }
    let kind = DrawableKind::from_extension(extension)
        .ok_or_else(|| format!("Unsupported GTA V model resource: .{extension}"))?;
    let mut fragment = None;
    let drawables = if kind == DrawableKind::Yft {
        let parsed = parse_yft(bytes)
            .map_err(|error| format!("Could not decode GTA V .{extension} resource: {error:#}"))?;
        let mut entries = Vec::new();
        if let Some(drawable) = &parsed.drawable {
            entries.push(DrawableEntry {
                hash: drawable.name_hash,
                name: if parsed.name.is_empty() {
                    drawable.name.clone()
                } else {
                    parsed.name.clone()
                },
                drawable: drawable.clone(),
            });
        }
        entries.extend(parsed.extra_drawables.iter().cloned());
        fragment = Some(parsed);
        entries
    } else {
        parse_drawables(bytes, kind)
            .map_err(|error| format!("Could not decode GTA V .{extension} resource: {error:#}"))?
    };
    if drawables.is_empty() {
        return Err(format!(
            "The GTA V .{extension} resource contains no drawables."
        ));
    }

    let selected = selected_drawable.unwrap_or(0);
    let drawable = drawables
        .get(selected)
        .ok_or_else(|| "The selected drawable is no longer available.".to_owned())?;

    let mut textures = TextureSet::new();
    if let Some(texture_bytes) = texture_dictionary {
        if let Ok(decoded) = rage_formats::ytd::parse_ytd(texture_bytes) {
            let mut pixel_budget = 16 * 1024 * 1024u64;
            let safe_textures = decoded
                .into_iter()
                .filter(|texture| {
                    let pixels = u64::from(texture.width) * u64::from(texture.height);
                    if texture.width > 4096
                        || texture.height > 4096
                        || pixels == 0
                        || pixels > pixel_budget
                    {
                        return false;
                    }
                    pixel_budget -= pixels;
                    true
                })
                .collect::<Vec<_>>();
            textures.push_layer(&safe_textures);
        }
    }

    let views = (0..VIEW_COUNT)
        .map(|index| View::Angle {
            azimuth: (index * 360 / VIEW_COUNT) as i16,
            elevation: 18,
        })
        .collect::<Vec<_>>();
    let options = RenderOptions {
        width: VIEW_SIZE,
        height: VIEW_SIZE,
        view: View::Iso,
        background: [8, 10, 12, 255],
        facing: Facing::Auto,
        ..RenderOptions::default()
    };
    let parts = if let Some(fragment) = &fragment {
        if selected == 0 {
            fragment
                .render_parts()
                .into_iter()
                .map(RenderPart::from)
                .collect::<Vec<_>>()
        } else {
            vec![RenderPart::new(&drawable.drawable)]
        }
    } else {
        vec![RenderPart::new(&drawable.drawable)]
    };
    let rendered = render_parts(&parts, &textures, &options, &views)
        .map_err(|error| format!("GTA V model rendering failed: {error:#}"))?;
    let Some((_, _, first_report)) = rendered.first() else {
        return Err("The GTA V model renderer produced no views.".into());
    };
    if first_report.triangles == 0 {
        return Err("The GTA V resource decoded, but contains no renderable geometry.".into());
    }
    let triangle_count = first_report.triangles;
    let geometry_count = first_report.geometries;
    let missing_texture_count = first_report.missing_textures.len();

    let mut total_size = 0usize;
    let mut rendered_views = Vec::with_capacity(rendered.len());
    for (view, image, _) in rendered {
        let mut png = Cursor::new(Vec::new());
        image
            .write_to(&mut png, ImageFormat::Png)
            .map_err(|error| format!("Could not encode GTA V model view: {error}"))?;
        let bytes = png.into_inner();
        total_size = total_size.saturating_add(bytes.len());
        if total_size > RENDERED_PREVIEW_LIMIT {
            return Err("The rendered views exceed the 20 MiB preview limit.".into());
        }
        let azimuth = view
            .angles()
            .map(|(azimuth, _)| azimuth)
            .ok_or_else(|| "The GTA V renderer returned an unexpected view.".to_owned())?;
        rendered_views.push(RenderedView {
            azimuth,
            image: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
    }

    serde_json::to_string(&NativeModelPreview {
        renderer: "rage-render",
        format: extension.to_ascii_uppercase(),
        drawables: drawables
            .iter()
            .map(|entry| DrawableOption {
                name: entry.name.clone(),
            })
            .collect(),
        selected_drawable: selected,
        triangles: triangle_count,
        geometries: geometry_count,
        textures: textures.len(),
        missing_textures: missing_texture_count,
        views: rendered_views,
    })
    .map_err(|error| format!("Could not prepare GTA V model preview: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_gta_resource_is_reported_instead_of_rendered() {
        assert!(render_gtav_model(b"not a resource", None, "ydr", None).is_err());
    }
}
