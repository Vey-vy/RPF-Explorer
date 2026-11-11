use crate::rpf::{decrypt_toc, ArchiveInfo, Key, Version};
use aes::cipher::{generic_array::GenericArray, BlockDecrypt, KeyInit};
use aes::Aes256;
use rayon::prelude::*;
use std::ops::Range;

fn distinct_bytes(w: &[u8]) -> u32 {
    let mut bits = [0u64; 4];
    for &b in w {
        bits[(b >> 6) as usize] |= 1 << (b & 63);
    }
    bits.iter().map(|x| x.count_ones()).sum()
}

fn root_like(b: &[u8]) -> bool {
    u32::from_le_bytes(b[0..4].try_into().unwrap()) == 0
        && u32::from_le_bytes(b[8..12].try_into().unwrap()) & 0x8000_0000 != 0
}

pub fn validate(key: &Key, toc_head: &[u8; 256]) -> bool {
    let cipher = Aes256::new(GenericArray::from_slice(key));
    let mut blk = [0u8; 16];
    blk.copy_from_slice(&toc_head[..16]);
    for _ in 0..16 {
        cipher.decrypt_block(GenericArray::from_mut_slice(&mut blk));
    }
    if !root_like(&blk) {
        return false;
    }
    let mut b = *toc_head;
    decrypt_toc(&mut b, key);
    b.iter().filter(|&&x| x == 0).count() >= 40
}

fn data_ranges(exe: &[u8]) -> Vec<Range<usize>> {
    let rd16 = |o: usize| {
        exe.get(o..o + 2)
            .map(|b| u16::from_le_bytes(b.try_into().unwrap()) as usize)
    };
    let rd32 = |o: usize| {
        exe.get(o..o + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
    };
    let mut out = Vec::new();
    let Some(pe) = rd32(0x3c).map(|x| x as usize) else {
        return out;
    };
    if exe.get(pe..pe + 4) != Some(b"PE\0\0") {
        return out;
    }
    let (Some(nsec), Some(opt)) = (rd16(pe + 6), rd16(pe + 20)) else {
        return out;
    };
    let table = pe + 24 + opt;
    for i in 0..nsec {
        let s = table + i * 40;
        let (Some(raw_size), Some(raw_ptr), Some(ch)) = (rd32(s + 16), rd32(s + 20), rd32(s + 36))
        else {
            break;
        };
        let (start, end) = (
            raw_ptr as usize,
            (raw_ptr as usize + raw_size as usize).min(exe.len()),
        );
        let executable = ch & 0x2000_0000 != 0;
        if !executable && start < end {
            out.push(start..end);
        }
    }
    out
}

fn scan(
    exe: &[u8],
    r: Range<usize>,
    step: usize,
    matches: &(impl Fn(&Key) -> bool + Sync),
) -> Option<(Key, usize)> {
    if r.end < r.start + 32 {
        return None;
    }
    let last = r.end - 32;
    let n = (last - r.start) / step + 1;
    (0..n).into_par_iter().find_map_any(|j| {
        let i = r.start + j * step;
        let w = &exe[i..i + 32];
        if distinct_bytes(w) < 20 {
            return None;
        }
        let key: Key = w.try_into().unwrap();
        matches(&key).then_some((key, i))
    })
}

pub fn validate_archive_key(key: &Key, archive: &ArchiveInfo) -> bool {
    if !archive.toc_encrypted {
        return true;
    }
    match archive.version {
        Version::Rpf4 => validate(key, &archive.toc_head),
        Version::Rpf2 | Version::Rpf3 => {
            let mut root = [0u8; 16];
            root.copy_from_slice(&archive.toc_head[..16]);
            decrypt_toc(&mut root, key);
            let child_start = u32::from_le_bytes(root[8..12].try_into().unwrap());
            let child_count = u32::from_le_bytes(root[12..16].try_into().unwrap());
            child_start & 0x8000_0000 != 0
                && ((child_start & 0x7fff_ffff) as usize)
                    .checked_add(child_count as usize)
                    .is_some_and(|end| end <= archive.entry_count)
        }
        Version::Rpf6 => {
            let mut root = [0u8; 32];
            root.copy_from_slice(&archive.toc_head[..32]);
            decrypt_toc(&mut root, key);
            let child_start = u32::from_be_bytes(root[8..12].try_into().unwrap());
            let child_count = u32::from_be_bytes(root[12..16].try_into().unwrap());
            child_start & 0x8000_0000 != 0
                && ((child_start & 0x7fff_ffff) as usize)
                    .checked_add(child_count as usize)
                    .is_some_and(|end| end <= archive.entry_count)
        }
        Version::Rpf7 | Version::Rpf8 => false,
    }
}

pub fn find_key_for_archive(exe: &[u8], archive: &ArchiveInfo) -> Option<(Key, usize)> {
    if !archive.toc_encrypted {
        return None;
    }
    let matches = |key: &Key| validate_archive_key(key, archive);
    find_key_matching(exe, &matches)
}

fn find_key_matching(exe: &[u8], matches: &(impl Fn(&Key) -> bool + Sync)) -> Option<(Key, usize)> {
    let data = data_ranges(exe);
    for r in &data {
        if let Some(x) = scan(exe, r.clone(), 4, matches) {
            return Some(x);
        }
    }
    for r in &data {
        if let Some(x) = scan(exe, r.clone(), 1, matches) {
            return Some(x);
        }
    }
    scan(exe, 0..exe.len(), 1, matches)
}

pub fn hex(k: &Key) -> String {
    k.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn parse_hex(s: &str) -> Option<Key> {
    let s = s.trim();
    if s.len() != 64 {
        return None;
    }
    let mut k = [0u8; 32];
    for i in 0..32 {
        k[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(k)
}
