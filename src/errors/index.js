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

module.exports = {
  AppError,
  ScannerError,
  ExtractionError,
  ExportError,
  LinkerError,
};
