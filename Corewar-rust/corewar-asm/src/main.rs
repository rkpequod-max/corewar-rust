use clap::Parser;
use corewar_common::*;
use corewar_asm::AsmError;
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

fn run(filename: &str, _verbose: bool) -> Result<(), AsmError> {
    let source = std::fs::read_to_string(filename)
        .map_err(|e| AsmError::IoError(format!("Cannot open file {}: {}", filename, e)))?;

    let (program_name, comment, code_size, cor_bytes) =
        corewar_asm::assemble_from_str_detailed(&source)?;

    // Write the .cor file
    let output_filename = utils::change_extension(filename, ".cor");
    std::fs::write(&output_filename, &cor_bytes)
        .map_err(|e| AsmError::IoError(format!("Failed to write {}: {}", output_filename, e)))?;

    if _verbose {
        println!(".name \"{}\"", program_name);
        println!(".comment \"{}\"", comment);
        println!("Code size: {} bytes", code_size);
        println!("Output: {}", output_filename);
    }

    Ok(())
}
