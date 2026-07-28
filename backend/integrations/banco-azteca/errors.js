class BancoAztecaError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'BancoAztecaError'
    this.code = options.code || 'BAZ_ERROR'
    this.httpStatus = options.httpStatus
    this.retryable = Boolean(options.retryable)
  }
}

module.exports = {
  BancoAztecaError
}
