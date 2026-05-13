pub mod lexer;
pub mod parser;
pub mod codegen;
pub mod error;

pub use error::AsmError;

/// Assemble a .s source string into a complete .cor file bytes.
/// This is the library entry point — no filesystem access required.
/// Returns the full .cor file bytes (header + bytecode) on success.
pub fn assemble_from_str(source: &str) -> Result<Vec<u8>, AsmError> {
    let (program_name, comment, code_tab) = lexer::parse_source(source)?;
    parser::validate_labels(&code_tab)?;
    let (prog_size, bytecode) = codegen::generate_bytecode(&code_tab)?;
    let cor_bytes = codegen::build_cor_bytes(&program_name, &comment, prog_size, &bytecode);
    Ok(cor_bytes)
}

/// Assemble a .s source string and return structured info.
/// Returns (name, comment, code_size, cor_bytes) on success.
pub fn assemble_from_str_detailed(source: &str) -> Result<(String, String, usize, Vec<u8>), AsmError> {
    let (program_name, comment, code_tab) = lexer::parse_source(source)?;
    parser::validate_labels(&code_tab)?;
    let (prog_size, bytecode) = codegen::generate_bytecode(&code_tab)?;
    let cor_bytes = codegen::build_cor_bytes(&program_name, &comment, prog_size, &bytecode);
    Ok((program_name, comment, prog_size as usize, cor_bytes))
}
