use crate::error::AsmError;
use crate::parser::{Arg, Instruction, Label};
use corewar_common::constants::*;
use corewar_common::op_table::*;
use corewar_common::types::itob;

/// Generate bytecode from the parsed labels/instructions
pub fn generate_bytecode(code_tab: &[Label]) -> Result<(u32, Vec<u8>), AsmError> {
    let mut prog_size: u32 = 0;
    let mut label_positions: Vec<(String, usize)> = Vec::new();

    // First pass: calculate positions and ACB
    let mut instructions_info: Vec<(usize, usize, u8, Vec<(Arg, usize)>)> = Vec::new();
    // (label_idx, instr_idx, acb, args_with_sizes)

    for (label_idx, label) in code_tab.iter().enumerate() {
        label_positions.push((label.label.clone(), prog_size as usize));

        for (instr_idx, instr) in label.instructions.iter().enumerate() {
            let op_info = instr.op_info();
            let _instr_pos = prog_size as usize;

            // Calculate ACB
            let acb = if op_info.has_acb() || instr.op_index == 15 {
                // aff has ACB even though nb_arg=1
                compute_acb(instr)
            } else {
                0
            };

            // Calculate argument sizes
            let arg_sizes = compute_arg_sizes(instr);
            let total_arg_size: usize = arg_sizes.iter().map(|(_, s)| s).sum();

            let instr_size = if acb != 0 {
                1 + 1 + total_arg_size // opcode + acb + args
            } else {
                1 + total_arg_size // opcode + args
            };

            instructions_info.push((label_idx, instr_idx, acb, arg_sizes));
            prog_size += instr_size as u32;
        }
    }

    // Second pass: resolve labels and fill bytecode
    let mut bytecode = Vec::new();

    for (label_idx, instr_idx, acb, arg_sizes) in &instructions_info {
        let instr = &code_tab[*label_idx].instructions[*instr_idx];
        let op_info = instr.op_info();
        let instr_pos = if bytecode.is_empty() {
            0
        } else {
            // Calculate from accumulated size
            let mut pos = 0;
            for (li, ii, _, _) in &instructions_info {
                if *li == *label_idx && *ii == *instr_idx {
                    break;
                }
                let i = &code_tab[*li].instructions[*ii];
                let i_op = i.op_info();
                let i_acb = if i_op.has_acb() || i.op_index == 15 {
                    compute_acb(i)
                } else {
                    0
                };
                let i_sizes = compute_arg_sizes(i);
                let i_total: usize = i_sizes.iter().map(|(_, s)| s).sum();
                pos += if i_acb != 0 { 1 + 1 + i_total } else { 1 + i_total };
            }
            pos
        };

        // Write opcode
        bytecode.push(op_info.opcode);

        // Write ACB if present
        if *acb != 0 {
            bytecode.push(*acb);
        }

        // Write arguments
        for (arg_idx, (_arg, size)) in arg_sizes.iter().enumerate() {
            let actual_arg = &instr.args[arg_idx];
            let mut bytes = vec![0u8; *size];

            match actual_arg {
                Arg::Reg(r) => {
                    bytes[0] = *r;
                }
                Arg::Dir(d) => {
                    if d.starts_with(LABEL_CHAR) {
                        // Label reference
                        let label_name = &d[1..];
                        let target_pos = find_label_pos(&label_positions, label_name)
                            .ok_or_else(|| AsmError::Label(format!(
                                "Unknown label: {}", label_name
                            )))?;
                        let offset = target_pos as i32 - instr_pos as i32;
                        itob(&mut bytes, offset as u32, *size);
                    } else {
                        // Numeric value (skip the % sign already removed)
                        // Handle large values with wrapping (like C atoi behavior)
                        let val: i32 = if let Ok(v) = d.parse::<i32>() {
                            v
                        } else if let Ok(v) = d.parse::<i64>() {
                            v as i32 // wraps on overflow, matching C behavior
                        } else {
                            return Err(AsmError::InvalidParam {
                                line: instr.line,
                                message: format!("Invalid direct value: {}", d),
                            });
                        };
                        itob(&mut bytes, val as u32, *size);
                    }
                }
                Arg::Ind(s) => {
                    if s.starts_with(LABEL_CHAR) {
                        let label_name = &s[1..];
                        let target_pos = find_label_pos(&label_positions, label_name)
                            .ok_or_else(|| AsmError::Label(format!(
                                "Unknown label: {}", label_name
                            )))?;
                        let offset = target_pos as i32 - instr_pos as i32;
                        itob(&mut bytes, offset as u32, *size);
                    } else {
                        let val: i32 = if let Ok(v) = s.parse::<i32>() {
                            v
                        } else if let Ok(v) = s.parse::<i64>() {
                            v as i32 // wraps on overflow
                        } else {
                            return Err(AsmError::InvalidParam {
                                line: instr.line,
                                message: format!("Invalid indirect value: {}", s),
                            });
                        };
                        itob(&mut bytes, val as u32, *size);
                    }
                }
            }

            bytecode.extend_from_slice(&bytes);
        }
    }

    Ok((prog_size, bytecode))
}

fn find_label_pos(positions: &[(String, usize)], name: &str) -> Option<usize> {
    for (label, pos) in positions {
        if label == name {
            return Some(*pos);
        }
    }
    None
}

fn compute_acb(instr: &Instruction) -> u8 {
    let mut acb: u8 = 0;
    let mut bit_pos: i32 = 7; // Start from the MSB of the ACB byte

    for arg in &instr.args {
        bit_pos -= 1; // Move to the start of the 2-bit slot
        match arg {
            Arg::Reg(_) => {
                acb |= 1 << bit_pos; // 01
            }
            Arg::Dir(_) => {
                acb |= 2 << bit_pos; // 10
            }
            Arg::Ind(_) => {
                acb |= 3 << bit_pos; // 11
            }
        }
        bit_pos -= 1;
    }

    acb
}

fn compute_arg_sizes(instr: &Instruction) -> Vec<(Arg, usize)> {
    let op_info = instr.op_info();
    let is_big = is_big_dir_op(op_info.name);

    instr.args.iter().map(|arg| {
        let size = match arg {
            Arg::Reg(_) => 1,
            Arg::Dir(_) => {
                if is_big { 4 } else { 2 }
            }
            Arg::Ind(_) => 2,
        };
        (arg.clone(), size)
    }).collect()
}

/// Build the complete .cor file bytes in memory (no filesystem access — for WASM / lib usage)
pub fn build_cor_bytes(
    program_name: &str,
    comment: &str,
    prog_size: u32,
    bytecode: &[u8],
) -> Vec<u8> {
    let header_size = 4 + PROG_NAME_LENGTH + 8 + COMMENT_LENGTH + 4;
    let mut buf = Vec::with_capacity(header_size + bytecode.len());

    // Magic number (big-endian)
    buf.extend_from_slice(&COREWAR_EXEC_MAGIC.to_be_bytes());

    // Program name (PROG_NAME_LENGTH bytes, null-padded)
    let mut name_bytes = vec![0u8; PROG_NAME_LENGTH];
    let copy_len = program_name.as_bytes().len().min(PROG_NAME_LENGTH);
    name_bytes[..copy_len].copy_from_slice(&program_name.as_bytes()[..copy_len]);
    buf.extend_from_slice(&name_bytes);

    // 8 bytes: 4 padding zeros + 4 bytes big-endian prog_size
    let mut size_bytes = [0u8; 8];
    size_bytes[4..8].copy_from_slice(&prog_size.to_be_bytes());
    buf.extend_from_slice(&size_bytes);

    // Comment (COMMENT_LENGTH bytes, null-padded)
    let mut comment_bytes = vec![0u8; COMMENT_LENGTH];
    let copy_len = comment.as_bytes().len().min(COMMENT_LENGTH);
    comment_bytes[..copy_len].copy_from_slice(&comment.as_bytes()[..copy_len]);
    buf.extend_from_slice(&comment_bytes);

    // 4 trailing zero bytes
    buf.extend_from_slice(&[0u8; 4]);

    // Bytecode
    buf.extend_from_slice(bytecode);

    buf
}

/// Write the complete .cor file
pub fn write_cor_file(
    filename: &str,
    program_name: &str,
    comment: &str,
    prog_size: u32,
    bytecode: &[u8],
) -> Result<(), AsmError> {
    use std::io::Write;

    let mut file = std::fs::File::create(filename).map_err(|e| {
        AsmError::IoError(format!("Failed to create {}: {}", filename, e))
    })?;

    // Write magic number (big-endian)
    let magic = COREWAR_EXEC_MAGIC.to_be_bytes();
    file.write_all(&magic).map_err(|e| AsmError::IoError(e.to_string()))?;

    // Write program name (PROG_NAME_LENGTH bytes, null-padded)
    let mut name_bytes = [0u8; PROG_NAME_LENGTH];
    let name_bytes_src = program_name.as_bytes();
    let copy_len = name_bytes_src.len().min(PROG_NAME_LENGTH);
    name_bytes[..copy_len].copy_from_slice(&name_bytes_src[..copy_len]);
    file.write_all(&name_bytes).map_err(|e| AsmError::IoError(e.to_string()))?;

    // Write prog_size (8 bytes: 4 padding zeros + 4 bytes big-endian size)
    let mut size_bytes = [0u8; 8];
    let ps = prog_size.to_be_bytes();
    size_bytes[4..8].copy_from_slice(&ps);
    file.write_all(&size_bytes).map_err(|e| AsmError::IoError(e.to_string()))?;

    // Write comment (COMMENT_LENGTH bytes, null-padded)
    let mut comment_bytes = [0u8; COMMENT_LENGTH];
    let comment_bytes_src = comment.as_bytes();
    let copy_len = comment_bytes_src.len().min(COMMENT_LENGTH);
    comment_bytes[..copy_len].copy_from_slice(&comment_bytes_src[..copy_len]);
    file.write_all(&comment_bytes).map_err(|e| AsmError::IoError(e.to_string()))?;

    // Write 4 trailing zero bytes
    let trailing = [0u8; 4];
    file.write_all(&trailing).map_err(|e| AsmError::IoError(e.to_string()))?;

    // Write bytecode
    file.write_all(bytecode).map_err(|e| AsmError::IoError(e.to_string()))?;

    Ok(())
}
