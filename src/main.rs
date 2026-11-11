#[cfg(feature = "gui")]
mod gui;
mod keyfinder;
mod rpf;

use std::path::Path;
use std::time::Instant;

fn cli(args: &[String]) {
    let usage = "usage:\n  --cli find-key <exe> <rpf>\n  --cli list <rpf> <hexkey> [max]\n  --cli test <rpf> <hexkey>\n  --cli extract <rpf> <hexkey> <outdir>";
    let key_arg = |i: usize| args.get(i).and_then(|s| keyfinder::parse_hex(s));
    match args.first().map(String::as_str) {
        Some("find-key") if args.len() >= 3 => {
            let exe = std::fs::File::open(&args[1]).expect("exe");
            let map = unsafe { memmap2::Mmap::map(&exe).expect("mmap") };
            let archive = rpf::inspect(Path::new(&args[2])).expect("archive RPF");
            let t = Instant::now();
            if !archive.toc_encrypted {
                println!("The TOC is not encrypted; no key is required");
            } else {
                match keyfinder::find_key_for_archive(&map, &archive) {
                    Some((k, off)) => println!(
                        "Key: {}\nFile offset: {off:#x}\nElapsed: {:.2?}",
                        keyfinder::hex(&k),
                        t.elapsed()
                    ),
                    None => println!("Key not found ({:.2?})", t.elapsed()),
                }
            }
        }
        Some("list") if args.len() >= 3 => {
            let key = key_arg(2).expect("64-character hexadecimal key");
            let r = rpf::Rpf::open(Path::new(&args[1]), &key).expect("open");
            let max: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(40);
            println!("{} entries", r.entries.len());
            for (i, e) in r.entries.iter().enumerate().take(max) {
                println!(
                    "{i:6} {} {} ({} B)",
                    if e.is_dir() { "D" } else { "F" },
                    e.name,
                    e.size()
                );
            }
        }
        Some("test") if args.len() >= 3 => {
            let key = key_arg(2).expect("hexadecimal key");
            let r = rpf::Rpf::open(Path::new(&args[1]), &key).expect("open");
            let t = Instant::now();
            let (mut ok, mut bad, mut bytes) = (0, 0, 0u64);
            for (i, e) in r.entries.iter().enumerate() {
                if e.is_dir() {
                    continue;
                }
                match r.read_file(i) {
                    Ok(d) if d.len() as u32 == e.size() => {
                        ok += 1;
                        bytes += d.len() as u64;
                    }
                    Ok(d) => {
                        bad += 1;
                        if bad <= 10 {
                            println!("Size mismatch: {} ({} vs {})", e.name, d.len(), e.size());
                        }
                    }
                    Err(err) => {
                        bad += 1;
                        if bad <= 10 {
                            println!("Error: {}: {err}", e.name);
                        }
                    }
                }
            }
            println!(
                "ok={ok} bad={bad} {} MB in {:.2?}",
                bytes >> 20,
                t.elapsed()
            );
        }
        Some("extract") if args.len() >= 4 => {
            let key = key_arg(2).expect("hexadecimal key");
            let r = rpf::Rpf::open(Path::new(&args[1]), &key).expect("open");
            let n = r.extract(0, Path::new(&args[3])).expect("extract");
            println!("Extracted {n} files");
        }
        _ => println!("{usage}"),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--cli") {
        cli(&args[1..]);
        return;
    }
    #[cfg(feature = "gui")]
    if let Err(e) = gui::run() {
        eprintln!("GUI error: {e}");
    }
    #[cfg(not(feature = "gui"))]
    cli(&args);
}
