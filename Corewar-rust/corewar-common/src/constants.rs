// Corewar constants from op.h

pub const IND_SIZE: usize = 2;
pub const REG_SIZE: usize = 4;
pub const DIR_SIZE: usize = REG_SIZE;

pub const REG_CODE: u8 = 1;
pub const DIR_CODE: u8 = 2;
pub const IND_CODE: u8 = 3;

pub const MAX_ARGS_NUMBER: usize = 4;
pub const MAX_PLAYERS: usize = 4;

pub const MEM_SIZE: usize = 4096;
pub const IDX_MOD: i32 = 512;
pub const CHAMP_MAX_SIZE: usize = 2048;

pub const COMMENT_CHAR: char = '#';
pub const LABEL_CHAR: char = ':';
pub const DIRECT_CHAR: char = '%';
pub const SEPARATOR_CHAR: char = ',';

pub const LABEL_CHARS: &str = "abcdefghijklmnopqrstuvwxyz_0123456789";

pub const NAME_CMD_STRING: &str = ".name";
pub const COMMENT_CMD_STRING: &str = ".comment";

pub const REG_NUMBER: usize = 16;

pub const CYCLE_TO_DIE: i32 = 1536;
pub const CYCLE_DELTA: i32 = 50;
pub const NBR_LIVE: i32 = 21;
pub const MAX_CHECKS: i32 = 10;

// Argument type bitmasks
pub const T_REG: u8 = 1;
pub const T_DIR: u8 = 2;
pub const T_IND: u8 = 4;
pub const T_LAB: u8 = 8;

pub const PROG_NAME_LENGTH: usize = 128;
pub const COMMENT_LENGTH: usize = 2048;

pub const COREWAR_EXEC_MAGIC: u32 = 0xea83f3;

// ACB parameter types (decoded from 2-bit fields)
pub const ACB_REG: u8 = 1;
pub const ACB_DIR: u8 = 2;
pub const ACB_IND: u8 = 3;
