mod lexer;
mod parser;
mod codegen;
mod error;

use clap::Parser;
use corewar_common::*;
use error::AsmError;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "asm", about = "Corewar assembler - translates .s to .cor")]
struct Args {
    /// Input .s file
    file: PathBuf,

    /// Verbose output
    #[arg(short = 'v')]
    verbose: bool,
}

fn main() {
    let args = Args::parse();

    let filename = args.file.to_string_lossy().to_string();

    if !utils::file_has_extension(&filename, ".s") {
        eprintln!("Error: assembler needs a .s file");
        std::process::exit(1);
    }

    match run(&filename, args.verbose) {
        Ok(()) => {}
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    }
}

fn run(filename: &str, verbose: bool) -> Result<(), AsmError> {
    let source = std::fs::read_to_string(filename)
        .map_err(|e| AsmError::IoError(format!("Cannot open file {}: {}", filename, e)))?;

    let (program_name, comment, code_tab) = lexer::parse_source(&source)?;

    // Validate labels
    parser::validate_labels(&code_tab)?;

    // Generate bytecode
    let (prog_size, bytecode) = codegen::generate_bytecode(&code_tab)?;

    if verbose {
        println!(".name \"{}\"", program_name);
        println!(".comment \"{}\"", comment);
        for label in &code_tab {
            println!("{}:", label.label);
            for instr in &label.instructions {
                print!("\t{} ", instr.op_name());
                for (i, arg) in instr.args.iter().enumerate() {
                    if i > 0 {
                        print!(", ");
                    }
                    match arg {
                        parser::Arg::Reg(r) => print!("r{}", r),
                        parser::Arg::Dir(d) => print!("%{}", d),
                        parser::Arg::Ind(i) => print!("{}", i),
                    }
                }
                println!();
            }
        }
    }

    // Write the .cor file
    let output_filename = utils::change_extension(filename, ".cor");
    codegen::write_cor_file(&output_filename, &program_name, &comment, prog_size, &bytecode)?;

    Ok(())
}
