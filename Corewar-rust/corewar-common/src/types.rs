use crate::constants::*;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CorewarError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid file: {0}")]
    InvalidFile(String),
    #[error("Invalid magic number in {0}")]
    InvalidMagic(String),
    #[error("Invalid champion size ({0}) in {1}")]
    InvalidChampSize(usize, String),
    #[error("Syntax error at line {line}: {message}")]
    Syntax { line: usize, message: String },
    #[error("Lexicon error at line {line}: {message}")]
    Lexicon { line: usize, message: String },
    #[error("Label error: {0}")]
    Label(String),
    #[error("Invalid parameter at line {line}: {message}")]
    InvalidParam { line: usize, message: String },
    #[error("Header size mismatch: header says {header}, actual is {actual}")]
    HeaderSizeMismatch { header: usize, actual: usize },
    #[error("{0}")]
    Other(String),
}

/// Argument type for instructions
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArgType {
    Reg,
    Dir,
    Ind,
}

/// Header structure matching the .cor file format
#[derive(Debug, Clone)]
pub struct Header {
    pub magic: u32,
    pub prog_name: [u8; PROG_NAME_LENGTH + 1],
    pub prog_size: u32,
    pub comment: [u8; COMMENT_LENGTH + 1],
}

impl Default for Header {
    fn default() -> Self {
        Header {
            magic: COREWAR_EXEC_MAGIC,
            prog_name: [0u8; PROG_NAME_LENGTH + 1],
            prog_size: 0,
            comment: [0u8; COMMENT_LENGTH + 1],
        }
    }
}

impl Header {
    pub fn prog_name_str(&self) -> String {
        let end = self.prog_name.iter().position(|&b| b == 0).unwrap_or(PROG_NAME_LENGTH);
        String::from_utf8_lossy(&self.prog_name[..end]).to_string()
    }

    pub fn comment_str(&self) -> String {
        let end = self.comment.iter().position(|&b| b == 0).unwrap_or(COMMENT_LENGTH);
        String::from_utf8_lossy(&self.comment[..end]).to_string()
    }

    /// Read a header from raw bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self, CorewarError> {
        if data.len() < 4 + PROG_NAME_LENGTH + 1 + 8 + COMMENT_LENGTH + 1 + 4 {
            return Err(CorewarError::InvalidFile("File too small for header".to_string()));
        }

        let mut offset = 0;

        // Read magic (big-endian)
        let magic = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
        offset += 4;

        // Read program name
        let mut prog_name = [0u8; PROG_NAME_LENGTH + 1];
        prog_name.copy_from_slice(&data[offset..offset + PROG_NAME_LENGTH + 1]);
        offset += PROG_NAME_LENGTH + 1;

        // Skip 8 bytes (padding + prog_size in header format)
        // Actually read prog_size as big-endian u32 from the 8-byte slot
        // The format is: 4 bytes padding (zeros) then 4 bytes prog_size
        // Wait - actually looking at the C code, it reads 8 bytes for size,
        // and the write code writes 8 bytes for size.
        // Let me re-examine: the C header is:
        //   unsigned int magic;         // 4 bytes
        //   char prog_name[129];        // 129 bytes
        //   unsigned int prog_size;      // 4 bytes  BUT written as 8 bytes in itob
        //   char comment[2049];          // 2049 bytes
        //   + 4 bytes padding at the end
        // Actually looking at write_binary.c: itob(size, file->prog_size, 8) writes 8 bytes
        // So there are 8 bytes for the size field, then COMMENT_LENGTH, then 4 trailing zero bytes

        // Skip the first 4 zero-padding bytes, then read 4-byte prog_size
        offset += 4; // skip padding
        let prog_size = u32::from_be_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]);
        offset += 4;

        // Read comment
        let mut comment = [0u8; COMMENT_LENGTH + 1];
        comment.copy_from_slice(&data[offset..offset + COMMENT_LENGTH + 1]);
        let _ = offset; // consumed all header bytes

        Ok(Header {
            magic,
            prog_name,
            prog_size,
            comment,
        })
    }

    /// Get the size of the full header in bytes
    pub fn header_size() -> usize {
        4 + (PROG_NAME_LENGTH + 1) + 8 + (COMMENT_LENGTH + 1) + 4
    }
}

/// Memory-safe modular arithmetic for the circular arena
pub fn mem_mod(x: i32) -> usize {
    let r = x % MEM_SIZE as i32;
    if r < 0 {
        (r + MEM_SIZE as i32) as usize
    } else {
        r as usize
    }
}

/// Read a big-endian integer from the arena/code at the given position
pub fn reverse_bytes(code: &[u8], pc: usize, bytes: usize) -> i32 {
    if bytes == 4 && pc + 3 < code.len() {
        i32::from_be_bytes([
            code[pc],
            code[pc + 1],
            code[pc + 2],
            code[pc + 3],
        ])
    } else if bytes == 2 && pc + 1 < code.len() {
        i16::from_be_bytes([code[pc], code[pc + 1]]) as i32
    } else {
        -1
    }
}

/// Read a big-endian integer from the arena with circular wrapping
pub fn reverse_bytes_circular(arena: &[u8; MEM_SIZE], pc: usize, bytes: usize) -> i32 {
    if bytes == 4 {
        let b0 = arena[mem_mod(pc as i32)];
        let b1 = arena[mem_mod(pc as i32 + 1)];
        let b2 = arena[mem_mod(pc as i32 + 2)];
        let b3 = arena[mem_mod(pc as i32 + 3)];
        i32::from_be_bytes([b0, b1, b2, b3])
    } else if bytes == 2 {
        let b0 = arena[mem_mod(pc as i32)];
        let b1 = arena[mem_mod(pc as i32 + 1)];
        i16::from_be_bytes([b0, b1]) as i32
    } else {
        -1
    }
}

/// Extract the ACB parameter type for a given parameter number (1-3)
pub fn p_acb(acb: u8, p_number: u8) -> u8 {
    match p_number {
        1 => (acb & 0b11000000) >> 6,
        2 => (acb & 0b00110000) >> 4,
        3 => (acb & 0b00001100) >> 2,
        _ => 1, // error
    }
}

/// Check if the argument types in the ACB match what the operation expects
pub fn is_argsize(_ir: usize, acb: u8, narg: u8, op_args: &[u8; 3]) -> bool {
    let mut m: i32 = 6;
    let mut i = 0;
    let mut narg = narg;
    while narg > 0 {
        let mut n: u8 = 0;
        let bits = (acb >> m) & 0b11;
        if bits != 0 {
            n = 1 << (bits - 1);
        }
        if n & op_args[i] == 0 {
            return false;
        }
        i += 1;
        narg -= 1;
        m -= 2;
    }
    true
}

/// Calculate the total byte shift for an instruction based on its ACB
pub fn octal_shift(acb: u8, label_size: u8, narg: u8) -> usize {
    let mut shift: usize = 2; // opcode + acb
    let mut acb = acb;
    let mut narg = narg;
    while narg < 4 {
        acb >>= 2;
        narg += 1;
    }
    while acb != 0 {
        match acb & 0b11 {
            1 => shift += 1, // REG
            3 => shift += 2, // IND
            2 => shift += label_size as usize, // DIR
            _ => {}
        }
        acb >>= 2;
    }
    shift
}

/// Convert an integer to big-endian bytes
pub fn itob(dest: &mut [u8], nb: u32, size: usize) {
    for i in (0..size).rev() {
        dest[i] = (nb >> (8 * (size - 1 - i))) as u8;
    }
}

/// Check if a register number is valid (1-16)
pub fn is_reg(code: &[u8], nb: usize) -> bool {
    if nb >= code.len() {
        return false;
    }
    let comp = code[nb];
    comp >= 1 && comp <= 16
}

/// Check if a register number is valid from the arena
pub fn is_reg_arena(arena: &[u8; MEM_SIZE], nb: i32) -> bool {
    let comp = arena[mem_mod(nb)];
    comp >= 1 && comp <= 16
}
