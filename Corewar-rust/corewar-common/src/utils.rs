use crate::constants::*;
use crate::types::CorewarError;

/// Check if a filename has the expected extension
pub fn file_has_extension(filename: &str, ext: &str) -> bool {
    filename.ends_with(ext)
}

/// Change the extension of a filename
pub fn change_extension(filename: &str, new_ext: &str) -> String {
    if let Some(pos) = filename.rfind('.') {
        format!("{}{}", &filename[..pos], new_ext)
    } else {
        format!("{}{}", filename, new_ext)
    }
}

/// Read the magic number from a .cor file and validate it
pub fn validate_magic(data: &[u8]) -> Result<u32, CorewarError> {
    if data.len() < 4 {
        return Err(CorewarError::InvalidMagic("File too small".to_string()));
    }
    let magic = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
    if magic != COREWAR_EXEC_MAGIC {
        return Err(CorewarError::InvalidMagic(format!(
            "Expected {:#x}, got {:#x}",
            COREWAR_EXEC_MAGIC, magic
        )));
    }
    Ok(magic)
}

/// Read a big-endian u32 from a slice
pub fn read_u32_be(data: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

/// Read a big-endian i32 from a slice
pub fn read_i32_be(data: &[u8], offset: usize) -> i32 {
    i32::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

/// Read a big-endian i16 from a slice
pub fn read_i16_be(data: &[u8], offset: usize) -> i16 {
    i16::from_be_bytes([data[offset], data[offset + 1]])
}
