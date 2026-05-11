use crate::error::AsmError;
use crate::parser::{Arg, Instruction, Label};
use corewar_common::constants::*;
use corewar_common::op_table::*;

/// Parse the entire source file into structured data
pub fn parse_source(source: &str) -> Result<(String, String, Vec<Label>), AsmError> {
    let mut program_name = String::new();
    let mut comment = String::new();
    let mut code_tab: Vec<Label> = Vec::new();
    let mut current_label: Option<Label> = None;
    let mut has_name = false;
    let mut has_comment = false;
    let mut in_name_quote = false;
    let mut in_comment_quote = false;
    let mut name_buffer = String::new();
    let mut comment_buffer = String::new();

    for (line_num, raw_line) in source.lines().enumerate() {
        let line_num = line_num + 1;
        let line = raw_line.trim();

        if line.is_empty() || line.starts_with(COMMENT_CHAR) {
            continue;
        }

        // Handle multi-line name quotes
        if in_name_quote {
            if let Some(end_pos) = line.find('"') {
                name_buffer.push_str(&line[..end_pos]);
                in_name_quote = false;
                if !has_name {
                    program_name = name_buffer.clone();
                    has_name = true;
                } else {
                    return Err(AsmError::Header(format!(
                        "Duplicate .name at line {}", line_num
                    )));
                }
                let after = line[end_pos + 1..].trim();
                if !after.is_empty() && !after.starts_with(COMMENT_CHAR) {
                    return Err(AsmError::Lexicon {
                        line: line_num,
                        message: "Invalid format after closing quote".to_string(),
                    });
                }
            } else {
                name_buffer.push_str(line);
                continue;
            }
            continue;
        }

        // Handle multi-line comment quotes
        if in_comment_quote {
            if let Some(end_pos) = line.find('"') {
                comment_buffer.push_str(&line[..end_pos]);
                in_comment_quote = false;
                if !has_comment {
                    comment = comment_buffer.clone();
                    has_comment = true;
                } else {
                    return Err(AsmError::Header(format!(
                        "Duplicate .comment at line {}", line_num
                    )));
                }
                let after = line[end_pos + 1..].trim();
                if !after.is_empty() && !after.starts_with(COMMENT_CHAR) {
                    return Err(AsmError::Lexicon {
                        line: line_num,
                        message: "Invalid format after closing quote".to_string(),
                    });
                }
            } else {
                comment_buffer.push_str(line);
                continue;
            }
            continue;
        }

        // Check for .name
        if line.starts_with(NAME_CMD_STRING) {
            let rest = line[NAME_CMD_STRING.len()..].trim();
            if !rest.starts_with('"') {
                return Err(AsmError::Lexicon {
                    line: line_num,
                    message: "Expected quote after .name".to_string(),
                });
            }
            let content = &rest[1..]; // skip opening quote
            if let Some(end_pos) = content.find('"') {
                let name = &content[..end_pos];
                if has_name {
                    return Err(AsmError::Header(format!(
                        "Duplicate .name at line {}", line_num
                    )));
                }
                program_name = name.to_string();
                has_name = true;
                let after = content[end_pos + 1..].trim();
                if !after.is_empty() && !after.starts_with(COMMENT_CHAR) {
                    return Err(AsmError::Lexicon {
                        line: line_num,
                        message: "Invalid format after closing quote".to_string(),
                    });
                }
            } else {
                name_buffer = content.to_string();
                in_name_quote = true;
            }
            continue;
        }

        // Check for .comment
        if line.starts_with(COMMENT_CMD_STRING) {
            let rest = line[COMMENT_CMD_STRING.len()..].trim();
            if !rest.starts_with('"') {
                return Err(AsmError::Lexicon {
                    line: line_num,
                    message: "Expected quote after .comment".to_string(),
                });
            }
            let content = &rest[1..];
            if let Some(end_pos) = content.find('"') {
                let comm = &content[..end_pos];
                if has_comment {
                    return Err(AsmError::Header(format!(
                        "Duplicate .comment at line {}", line_num
                    )));
                }
                comment = comm.to_string();
                has_comment = true;
                let after = content[end_pos + 1..].trim();
                if !after.is_empty() && !after.starts_with(COMMENT_CHAR) {
                    return Err(AsmError::Lexicon {
                        line: line_num,
                        message: "Invalid format after closing quote".to_string(),
                    });
                }
            } else {
                comment_buffer = content.to_string();
                in_comment_quote = true;
            }
            continue;
        }

        // Parse code lines
        // Remove comments
        let code_line = if let Some(hash_pos) = line.find(COMMENT_CHAR) {
            &line[..hash_pos]
        } else {
            line
        };

        let code_line = code_line.trim();
        if code_line.is_empty() {
            continue;
        }

        // Parse the line directly using character-level parsing
        let mut pos = 0;
        let chars: Vec<char> = code_line.chars().collect();

        // Skip whitespace
        while pos < chars.len() && chars[pos].is_whitespace() {
            pos += 1;
        }

        // Check for label
        let label_end = find_label_end(&chars, pos);
        if label_end > pos {
            let label_name: String = chars[pos..label_end].iter().collect();
            // Validate label characters
            for ch in label_name.chars() {
                if !LABEL_CHARS.contains(ch) {
                    return Err(AsmError::Lexicon {
                        line: line_num,
                        message: format!("Invalid character '{}' in label name", ch),
                    });
                }
            }

            if let Some(lbl) = current_label.take() {
                code_tab.push(lbl);
            }

            current_label = Some(Label {
                label: label_name,
                instructions: Vec::new(),
            });

            pos = label_end + 1; // skip the colon
            // Skip whitespace after label
            while pos < chars.len() && chars[pos].is_whitespace() {
                pos += 1;
            }
        }

        // Check for instruction
        if pos < chars.len() {
            // Read the opcode name (stop at whitespace, comma, or '%' for cases like "fork%:label")
            let op_start = pos;
            while pos < chars.len() && !chars[pos].is_whitespace() && chars[pos] != ',' && chars[pos] != DIRECT_CHAR {
                pos += 1;
            }
            let op_name: String = chars[op_start..pos].iter().collect();

            // Skip whitespace
            while pos < chars.len() && chars[pos].is_whitespace() {
                pos += 1;
            }

            // Find the operation
            let op_result = find_op(&op_name);
            match op_result {
                Some(op_idx) => {
                    let op_info = &OP_TABLE[op_idx];

                    // The rest of the line is the argument string
                    let arg_str: String = chars[pos..].iter().collect();

                    let args = parse_arguments(&arg_str, op_idx, line_num)?;

                    // Validate argument count
                    if args.len() != op_info.nb_arg as usize {
                        return Err(AsmError::InvalidParam {
                            line: line_num,
                            message: format!(
                                "Expected {} arguments, got {}",
                                op_info.nb_arg,
                                args.len()
                            ),
                        });
                    }

                    // Validate argument types
                    for (i, arg) in args.iter().enumerate() {
                        let allowed = op_info.args[i];
                        let arg_type_bit = match arg {
                            Arg::Reg(_) => T_REG,
                            Arg::Dir(_) => T_DIR,
                            Arg::Ind(_) => T_IND,
                        };
                        if arg_type_bit & allowed == 0 {
                            return Err(AsmError::InvalidParam {
                                line: line_num,
                                message: format!(
                                    "Invalid argument type for parameter {} of {}",
                                    i + 1,
                                    op_info.name
                                ),
                            });
                        }
                    }

                    let instr = Instruction {
                        line: line_num,
                        op_index: op_idx,
                        args,
                    };

                    if current_label.is_none() {
                        current_label = Some(Label {
                            label: "MAIN_LABEL".to_string(),
                            instructions: Vec::new(),
                        });
                    }

                    current_label.as_mut().unwrap().instructions.push(instr);
                }
                None => {
                    return Err(AsmError::Lexicon {
                        line: line_num,
                        message: format!("Invalid instruction: '{}'", op_name),
                    });
                }
            }
        }
    }

    // Push the last label
    if let Some(lbl) = current_label.take() {
        code_tab.push(lbl);
    }

    if !has_name {
        return Err(AsmError::Header("Missing .name directive".to_string()));
    }

    Ok((program_name, comment, code_tab))
}

/// Find the end of a label (position of the colon)
fn find_label_end(chars: &[char], start: usize) -> usize {
    let mut pos = start;
    while pos < chars.len() {
        if chars[pos] == LABEL_CHAR {
            // Check that all characters before the colon are valid label chars
            let label: String = chars[start..pos].iter().collect();
            let all_valid = label.chars().all(|c| LABEL_CHARS.contains(c));
            if all_valid && !label.is_empty() {
                return pos;
            }
        }
        if !LABEL_CHARS.contains(chars[pos]) && chars[pos] != LABEL_CHAR {
            break;
        }
        pos += 1;
    }
    0 // No label found
}

fn find_op(token: &str) -> Option<usize> {
    for (i, op) in OP_TABLE.iter().enumerate() {
        if token == op.name {
            return Some(i);
        }
    }
    None
}

/// Parse argument string like "r1, %:live, %1" into a list of arguments
fn parse_arguments(arg_str: &str, op_idx: usize, line_num: usize) -> Result<Vec<Arg>, AsmError> {
    let op_info = &OP_TABLE[op_idx];
    let nb_arg = op_info.nb_arg as usize;

    let arg_str = arg_str.trim();
    if arg_str.is_empty() && nb_arg > 0 {
        return Err(AsmError::InvalidParam {
            line: line_num,
            message: "Missing arguments".to_string(),
        });
    }

    // Split by commas
    let parts: Vec<&str> = arg_str.split(',').map(|s| s.trim()).collect();

    let mut args = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        if i >= nb_arg {
            return Err(AsmError::InvalidParam {
                line: line_num,
                message: "Too many arguments".to_string(),
            });
        }

        let part = part.trim();
        if part.is_empty() {
            return Err(AsmError::InvalidParam {
                line: line_num,
                message: "Empty argument".to_string(),
            });
        }

        let allowed = op_info.args[i];

        if part.starts_with('r') || part.starts_with('R') {
            // Register
            if allowed & T_REG == 0 {
                return Err(AsmError::InvalidParam {
                    line: line_num,
                    message: format!("Register not allowed for parameter {}", i + 1),
                });
            }
            let reg_str = &part[1..];
            let reg_num: u8 = reg_str.parse().map_err(|_| AsmError::InvalidParam {
                line: line_num,
                message: format!("Invalid register: {}", part),
            })?;
            if reg_num < 1 || reg_num > REG_NUMBER as u8 {
                return Err(AsmError::InvalidParam {
                    line: line_num,
                    message: format!("Register number out of range: {}", reg_num),
                });
            }
            args.push(Arg::Reg(reg_num));
        } else if part.starts_with(DIRECT_CHAR) {
            // Direct
            if allowed & T_DIR == 0 {
                return Err(AsmError::InvalidParam {
                    line: line_num,
                    message: format!("Direct not allowed for parameter {}", i + 1),
                });
            }
            let dir_content = &part[1..]; // skip %
            // Validate the direct value is a number or :label
            if !dir_content.starts_with(':') {
                // Try to parse as a number (allow wrapping for large values)
                if dir_content.parse::<i64>().is_err() && dir_content.parse::<i32>().is_err() {
                    return Err(AsmError::InvalidParam {
                        line: line_num,
                        message: format!("Invalid direct value: {}", part),
                    });
                }
            }
            args.push(Arg::Dir(dir_content.to_string()));
        } else {
            // Indirect
            if allowed & T_IND == 0 {
                return Err(AsmError::InvalidParam {
                    line: line_num,
                    message: format!("Indirect not allowed for parameter {}", i + 1),
                });
            }
            // Validate the indirect value is a number or :label
            if !part.starts_with(':') {
                if part.parse::<i64>().is_err() && part.parse::<i32>().is_err() {
                    return Err(AsmError::InvalidParam {
                        line: line_num,
                        message: format!("Invalid indirect value: {}", part),
                    });
                }
            }
            args.push(Arg::Ind(part.to_string()));
        }
    }

    if args.len() != nb_arg {
        return Err(AsmError::InvalidParam {
            line: line_num,
            message: format!("Expected {} arguments, got {}", nb_arg, args.len()),
        });
    }

    Ok(args)
}
