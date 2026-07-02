class AppError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
}

class ScannerError extends AppError {}
class ExtractionError extends AppError {}
class ExportError extends AppError {}
class LinkerError extends AppError {}
class LlmError extends AppError {
  constructor(message, { code, statusCode, cause } = {}) {
    super(message, cause);
    this.code = code;
    this.statusCode = statusCode;
  }
}
class PersistenceError extends AppError {}
class ValidationError extends AppError {}
class CryptoError extends AppError {}
class FileReaderError extends AppError {}

module.exports = {
  AppError,
  ScannerError,
  ExtractionError,
  ExportError,
  LinkerError,
  LlmError,
  PersistenceError,
  ValidationError,
  CryptoError,
  FileReaderError,
};
