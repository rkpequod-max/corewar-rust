use crate::constants::*;

/// Information about a single operation in the Corewar instruction set
#[derive(Debug, Clone)]
pub struct OpInfo {
    pub name: &'static str,
    pub nb_arg: u8,
    pub args: [u8; 3],
    pub opcode: u8,
    pub cycle: u32,
    pub description: &'static str,
    pub octal: u8,   // 1 = has ACB, 0 = no ACB
    pub label: u8,   // 0 = direct is 4 bytes, 1 = direct is 2 bytes
}

impl OpInfo {
    /// Get the label_size (direct argument size): 2 if label==1, 4 if label==0
    pub fn dir_size(&self) -> u8 {
        if self.label == 1 { 2 } else { 4 }
    }

    /// Whether this operation uses an Argument Coding Byte
    pub fn has_acb(&self) -> bool {
        self.octal == 1
    }
}

/// The global operation table - 16 operations
pub static OP_TABLE: [OpInfo; 16] = [
    OpInfo { // 0 - live
        name: "live",
        nb_arg: 1,
        args: [T_DIR, 0, 0],
        opcode: 1,
        cycle: 10,
        description: "alive",
        octal: 0,
        label: 0,
    },
    OpInfo { // 1 - ld
        name: "ld",
        nb_arg: 2,
        args: [T_DIR | T_IND, T_REG, 0],
        opcode: 2,
        cycle: 5,
        description: "load",
        octal: 1,
        label: 0,
    },
    OpInfo { // 2 - st
        name: "st",
        nb_arg: 2,
        args: [T_REG, T_IND | T_REG, 0],
        opcode: 3,
        cycle: 5,
        description: "store",
        octal: 1,
        label: 0,
    },
    OpInfo { // 3 - add
        name: "add",
        nb_arg: 3,
        args: [T_REG, T_REG, T_REG],
        opcode: 4,
        cycle: 10,
        description: "addition",
        octal: 1,
        label: 0,
    },
    OpInfo { // 4 - sub
        name: "sub",
        nb_arg: 3,
        args: [T_REG, T_REG, T_REG],
        opcode: 5,
        cycle: 10,
        description: "soustraction",
        octal: 1,
        label: 0,
    },
    OpInfo { // 5 - and
        name: "and",
        nb_arg: 3,
        args: [T_REG | T_DIR | T_IND, T_REG | T_IND | T_DIR, T_REG],
        opcode: 6,
        cycle: 6,
        description: "et (and  r1, r2, r3   r1&r2 -> r3",
        octal: 1,
        label: 0,
    },
    OpInfo { // 6 - or
        name: "or",
        nb_arg: 3,
        args: [T_REG | T_IND | T_DIR, T_REG | T_IND | T_DIR, T_REG],
        opcode: 7,
        cycle: 6,
        description: "ou  (or   r1, r2, r3   r1 | r2 -> r3",
        octal: 1,
        label: 0,
    },
    OpInfo { // 7 - xor
        name: "xor",
        nb_arg: 3,
        args: [T_REG | T_IND | T_DIR, T_REG | T_IND | T_DIR, T_REG],
        opcode: 8,
        cycle: 6,
        description: "ou (xor  r1, r2, r3   r1^r2 -> r3",
        octal: 1,
        label: 0,
    },
    OpInfo { // 8 - zjmp
        name: "zjmp",
        nb_arg: 1,
        args: [T_DIR, 0, 0],
        opcode: 9,
        cycle: 20,
        description: "jump if zero",
        octal: 0,
        label: 1,
    },
    OpInfo { // 9 - ldi
        name: "ldi",
        nb_arg: 3,
        args: [T_REG | T_DIR | T_IND, T_DIR | T_REG, T_REG],
        opcode: 10,
        cycle: 25,
        description: "load index",
        octal: 1,
        label: 1,
    },
    OpInfo { // 10 - sti
        name: "sti",
        nb_arg: 3,
        args: [T_REG, T_REG | T_DIR | T_IND, T_DIR | T_REG],
        opcode: 11,
        cycle: 25,
        description: "store index",
        octal: 1,
        label: 1,
    },
    OpInfo { // 11 - fork
        name: "fork",
        nb_arg: 1,
        args: [T_DIR, 0, 0],
        opcode: 12,
        cycle: 800,
        description: "fork",
        octal: 0,
        label: 1,
    },
    OpInfo { // 12 - lld
        name: "lld",
        nb_arg: 2,
        args: [T_DIR | T_IND, T_REG, 0],
        opcode: 13,
        cycle: 10,
        description: "long load",
        octal: 1,
        label: 0,
    },
    OpInfo { // 13 - lldi
        name: "lldi",
        nb_arg: 3,
        args: [T_REG | T_DIR | T_IND, T_DIR | T_REG, T_REG],
        opcode: 14,
        cycle: 50,
        description: "long load index",
        octal: 1,
        label: 1,
    },
    OpInfo { // 14 - lfork
        name: "lfork",
        nb_arg: 1,
        args: [T_DIR, 0, 0],
        opcode: 15,
        cycle: 1000,
        description: "long fork",
        octal: 0,
        label: 1,
    },
    OpInfo { // 15 - aff
        name: "aff",
        nb_arg: 1,
        args: [T_REG, 0, 0],
        opcode: 16,
        cycle: 2,
        description: "aff",
        octal: 1,
        label: 0,
    },
];

/// Find an operation by opcode (1-16)
pub fn op_by_opcode(opcode: u8) -> Option<&'static OpInfo> {
    if opcode >= 1 && opcode <= 16 {
        Some(&OP_TABLE[opcode as usize - 1])
    } else {
        None
    }
}

/// Find an operation by name
pub fn op_by_name(name: &str) -> Option<(usize, &'static OpInfo)> {
    for (i, op) in OP_TABLE.iter().enumerate() {
        if op.name == name {
            return Some((i, op));
        }
    }
    None
}

/// Check if an operation name uses 4-byte direct arguments
pub fn is_big_dir_op(op_name: &str) -> bool {
    matches!(op_name, "and" | "or" | "xor" | "live" | "ld" | "lld")
}
