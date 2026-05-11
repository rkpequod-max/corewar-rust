use crate::error::AsmError;
use corewar_common::op_table::*;

/// An argument to an instruction
#[derive(Debug, Clone)]
pub enum Arg {
    Reg(u8),
    Dir(String),  // includes the % prefix content, or :label
    Ind(String),  // a number or :label
}

/// A single instruction
#[derive(Debug, Clone)]
pub struct Instruction {
    pub line: usize,
    pub op_index: usize, // index into OP_TABLE
    pub args: Vec<Arg>,
}

impl Instruction {
    pub fn op_name(&self) -> &'static str {
        OP_TABLE[self.op_index].name
    }

    pub fn op_info(&self) -> &'static OpInfo {
        &OP_TABLE[self.op_index]
    }
}

/// A label with its associated instructions
#[derive(Debug, Clone)]
pub struct Label {
    pub label: String,
    pub instructions: Vec<Instruction>,
}

/// Check if all label references exist
pub fn validate_labels(code_tab: &[Label]) -> Result<(), AsmError> {
    // Collect all defined labels
    let defined: Vec<&str> = code_tab.iter().map(|l| l.label.as_str()).collect();

    // Check all references
    for label in code_tab {
        for instr in &label.instructions {
            for arg in &instr.args {
                match arg {
                    Arg::Dir(s) => {
                        if s.starts_with(':') {
                            let ref_label = &s[1..];
                            if !defined.contains(&ref_label) {
                                return Err(AsmError::Label(format!(
                                    "Unknown label '{}' referenced at line {}",
                                    ref_label, instr.line
                                )));
                            }
                        }
                    }
                    Arg::Ind(s) => {
                        if s.starts_with(':') {
                            let ref_label = &s[1..];
                            if !defined.contains(&ref_label) {
                                return Err(AsmError::Label(format!(
                                    "Unknown label '{}' referenced at line {}",
                                    ref_label, instr.line
                                )));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(())
}
