use thiserror::Error;

#[derive(Debug, Error)]
pub enum AsmError {
    #[error("IO error: {0}")]
    IoError(String),
    #[error("Syntax error at line {line}: {message}")]
    Syntax { line: usize, message: String },
    #[error("Lexicon error at line {line}: {message}")]
    Lexicon { line: usize, message: String },
    #[error("Label error: {0}")]
    Label(String),
    #[error("Invalid parameter at line {line}: {message}")]
    InvalidParam { line: usize, message: String },
    #[error("Header error: {0}")]
    Header(String),
    #[error("{0}")]
    Other(String),
}
