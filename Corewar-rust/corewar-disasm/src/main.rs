use clap::Parser;
use corewar_common::constants::*;
use corewar_common::op_table::*;
use corewar_common::types::*;
use corewar_common::utils::*;
use std::io::Write;

#[derive(Parser, Debug)]
#[command(name = "disasm", about = "Corewar disassembler - translates .cor to .s")]
struct Args {
    /// Input .cor file
    file: String,
}

fn main() {
    let args = Args::parse();

    if let Err(e) = run(&args.file) {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
}

fn run(filename: &str) -> Result<(), Box<dyn std::error::Error>> {
    if !file_has_extension(filename, ".cor") {
        return Err(format!("File must have .cor extension: {}", filename).into());
    }

    let data = std::fs::read(filename)?;

    // Validate magic
    validate_magic(&data)?;

    // Parse header
    let header_size = Header::header_size();
    if data.len() < header_size {
        return Err("File too small for header".into());
    }

    let header = Header::from_bytes(&data)?;

    // Check champion size
    let code_size = data.len() - header_size;
    if code_size > CHAMP_MAX_SIZE {
        return Err(format!("Champion too large: {} bytes", code_size).into());
    }

    let code = &data[header_size..];

    // Create output filename
    let output_filename = change_extension(filename, "-dis.s");

    let mut out = std::fs::File::create(&output_filename)?;

    // Write header
    writeln!(out, ".name \"{}\"", header.prog_name_str())?;
    writeln!(out, ".comment \"{}\"", header.comment_str())?;

    // Disassemble
    let mut pos = 0;
    while pos < code.len() {
        let byte = code[pos];
        if byte < 1 || byte > 16 {
            break;
        }

        let op_info = &OP_TABLE[byte as usize - 1];
        write!(out, "{}", op_info.name)?;
        if op_info.name.len() < 4 {
            write!(out, "\t")?;
        }
        write!(out, "\t")?;

        let new_pos = disassemble_op(code, pos, op_info, &mut out)?;
        writeln!(out)?;
        pos = new_pos;
    }

    Ok(())
}

fn disassemble_op(
    code: &[u8],
    pos: usize,
    op_info: &OpInfo,
    out: &mut dyn Write,
) -> Result<usize, Box<dyn std::error::Error>> {
    match op_info.name {
        "live" => disasm_live(code, pos, out),
        "ld" => disasm_ld(code, pos, out),
        "st" => disasm_st(code, pos, out),
        "add" => disasm_add(code, pos, out),
        "sub" => disasm_sub(code, pos, out),
        "and" => disasm_disect(code, pos, 0, out),
        "or" => disasm_disect(code, pos, 0, out),
        "xor" => disasm_disect(code, pos, 0, out),
        "zjmp" => disasm_zjmp(code, pos, out),
        "ldi" => disasm_disect(code, pos, 2, out),
        "sti" => disasm_sti(code, pos, out),
        "fork" => disasm_fork(code, pos, out),
        "lld" => disasm_lld(code, pos, out),
        "lldi" => disasm_disect(code, pos, 2, out),
        "lfork" => disasm_lfork(code, pos, out),
        "aff" => disasm_aff(code, pos, out),
        _ => Err(format!("Unknown op: {}", op_info.name).into()),
    }
}

fn disasm_live(code: &[u8], pos: usize, out: &mut dyn Write) -> Result<usize, Box<dyn std::error::Error>> {
    if pos + 4 >= code.len() {
        return Err("Truncated live instruction".into());
    }
    let live = reverse_bytes(code, pos + 1, 4);
    write!(out, "%{}", live)?;
    Ok(pos + 5)
}

fn disasm_ld(code: &[u8], pos: usize, out: &mut dyn Write) -> Result<usize, Box<dyn std::error::Error>> {
    let acb = code[pos + 1];
    let reg_pos = pos + 6 - ((acb & 0b01100000) >> 5) as usize;

    let p1 = p_acb(acb, 1);
    let p2 = p_acb(acb, 2);

    if (p1 == ACB_DIR || p1 == ACB_IND) && p2 == ACB_REG && is_reg(code, reg_pos) {
        if p1 == ACB_DIR {
            let move_val = reverse_bytes(code, pos + 2, 4);
            write!(out, "%{}, ", move_val)?;
        } else {
            let move_val = reverse_bytes(code, pos + 2, 2) % IDX_MOD;
            write!(out, "{}, ", move_val)?;
        }
        write!(out, "r{}", code[reg_pos])?;
    }

    Ok(pos + octal_shift(acb, 4, 2))
}

fn disasm_st(code: &[u8], pos: usize, out: &mut dyn Write) -> Result<usize, Box<dyn std::error::Error>> {
    let acb = code[pos + 1];
    let p1 = p_acb(acb, 1);
    let p2 = p_acb(acb, 2);

    if p1 == ACB_REG && is_reg(code, pos + 2) {
        write!(out, "r{}, ", code[pos + 2])?;
        if p2 == ACB_REG && is_reg(code, pos + 3) {
            write!(out, "r{}", code[pos + 3])?;
        } else if p2 == ACB_IND {
            let move_val = reverse_bytes(code, pos + 3, 2);
            write!(out, "{}", move_val)?;
        }
    }

    Ok(pos + octal_shift(acb, 4, 2))
}

fn disasm_add(code: &[u8], pos: usize, out: &mut dyn Write) -> Result<usize, Box<dyn std::error::Error>> {
    let acb = code[pos + 1];
    if is_argsize(3, acb, 3, &OP_TABLE[3].args) && is_reg(code, pos + 2)
        && is_reg(code, pos + 3) && is_reg(code, pos + 4)
    {
        write!(out, "r{}, r{}, r{}", code[pos + 2], code[pos + 3], code[pos + 4])?;
    }
    Ok(pos + octal_shift(acb, 4, 3))
}

fn disasm_sub(code: &[u8], pos: usize, out: &mut dyn Write) -> Result<usize, Box<dyn std::error::Error>> {
    let acb = code[pos + 1];
    if is_argsize(4, acb, 3, &OP_TABLE[4].args) && is_reg(code, pos + 2)
        && is_reg(code, pos + 3) && is_reg(code, pos + 4)
    {
        write!(out, "r{}, r{}, r{}", code[pos + 2], code[pos + 3], code[pos + 4])?;
    }
    Ok(pos + octal_shift(acb, 4, 3))
}

fn disasm_zjmp(code: &[u8], pos: usize, out: &mut dyn Write) -> Result<usize, Box<dyn std::error::Error>> {
    let move_val = reverse_bytes(code, pos + 1, 2) % IDX_MOD;
    write!(out, "%{}", move_val)?;
    Ok(pos + 3)
}

fn disasm_sti(code: &[u8], pos: usize, out: &mut dyn Write) -> Result<usize, Box<dyn std::error::Error>> {
    let acb = code[pos + 1];
    let mut args = 3;
    let mut mv: usize = 0;

    if is_argsize(10, acb, 3, &OP_TABLE[10].args) {
        while args > 0 {
            args -= 1;
            let acb_type = (acb >> ((args + 1) * 2)) & 0b11;
            if acb_type == ACB_REG && !is_reg(code, pos + 2 + mv) {
                break;
            }

            let type_for_get = acb_type + 4;
            get_arg_disasm(code, pos, &mut mv, type_for_get, out)?;

            if args > 0 {
                write!(out, ", ")?;
            }
        }
    }

    Ok(pos + octal_shift(acb, 2, 3))
}

fn disasm_fork(code: &[u8], pos: usize, out: &mut dyn Write) -> Result<usize, Box<dyn std::error::Error>> {
    let move_val = reverse_bytes(code, pos + 1, 2);
    write!(out, "%{}", move_val)?;
    Ok(pos + 3)
}

fn disasm_lld(code: &[u8], pos: usize, out: &mut dyn Write) -> Result<usize, Box<dyn std::error::Error>> {
    let acb = code[pos + 1];
    let reg_pos = pos + 6 - ((acb & 0b01100000) >> 5) as usize;

    if is_argsize(12, acb, 2, &OP_TABLE[12].args) && is_reg(code, reg_pos) {
        if p_acb(acb, 1) == ACB_DIR {
            let move_val = reverse_bytes(code, pos + 2, 4);
            write!(out, "%{}, ", move_val)?;
        } else {
            let move_val = reverse_bytes(code, pos + 2, 2);
            write!(out, "{}, ", move_val)?;
        }
        write!(out, "r{}", code[reg_pos])?;
    }

    Ok(pos + octal_shift(acb, 4, 2))
}

fn disasm_lfork(code: &[u8], pos: usize, out: &mut dyn Write) -> Result<usize, Box<dyn std::error::Error>> {
    let move_val = reverse_bytes(code, pos + 1, 2);
    write!(out, "%{}", move_val)?;
    Ok(pos + 3)
}

fn disasm_aff(code: &[u8], pos: usize, out: &mut dyn Write) -> Result<usize, Box<dyn std::error::Error>> {
    let acb = code[pos + 1];
    if p_acb(acb, 1) == ACB_REG && is_reg(code, pos + 2) {
        write!(out, "r{}", code[pos + 2])?;
    }
    Ok(pos + octal_shift(acb, 4, 1))
}

/// Disassemble using disect_args pattern (for and, or, xor, ldi, lldi)
fn disasm_disect(
    code: &[u8],
    pos: usize,
    l: u8, // 0 = compare function, 2 = load function
    out: &mut dyn Write,
) -> Result<usize, Box<dyn std::error::Error>> {
    let acb = code[pos + 1];
    let opcode = code[pos];
    let op_idx = opcode as usize - 1;

    if is_argsize(op_idx, acb, 3, &OP_TABLE[op_idx].args) {
        let mut args = 3;
        let mut move_offset: usize = 0;

        while args > 0 {
            args -= 1;
            let acb_type = (acb >> ((args + 1) * 2)) & 0b11;

            if acb_type == ACB_REG && !is_reg(code, pos + 2 + move_offset) {
                break;
            }

            let type_for_get = acb_type + l * 2;
            get_arg_disasm(code, pos, &mut move_offset, type_for_get, out)?;

            if args > 0 {
                write!(out, ", ")?;
            }
        }
    }

    Ok(pos + octal_shift(acb, 4 - l, 3))
}

fn get_arg_disasm(
    code: &[u8],
    pos: usize,
    move_offset: &mut usize,
    arg_type: u8,
    out: &mut dyn Write,
) -> Result<(), Box<dyn std::error::Error>> {
    let label_size: u8 = if arg_type >> 2 != 0 { 2 } else { 4 };

    match arg_type & 0b11 {
        1 => {
            // Register
            let value = code[pos + 2 + *move_offset];
            *move_offset += 1;
            write!(out, "r{}", value)?;
        }
        2 => {
            // Direct
            let ret = reverse_bytes(code, pos + 2 + *move_offset, label_size as usize);
            *move_offset += label_size as usize;
            write!(out, "%{}", ret)?;
        }
        3 => {
            // Indirect
            let value = reverse_bytes(code, pos + 2 + *move_offset, 2) % IDX_MOD;
            *move_offset += 2;
            write!(out, "{}", value)?;
        }
        _ => {}
    }

    Ok(())
}
