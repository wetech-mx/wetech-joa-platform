const {
  constants,
  createPrivateKey,
  privateDecrypt
} = require('node:crypto')

const { BancoAztecaError } = require('./errors')

function createBankPrivateKey(privateKeyBase64) {
  try {
    return createPrivateKey({
      key: Buffer.from(privateKeyBase64, 'base64'),
      format: 'der',
      type: 'pkcs8'
    })
  } catch {
    throw new BancoAztecaError(
      'La llave privada entregada por el banco no es válida',
      { code: 'BAZ_INVALID_PRIVATE_KEY' }
    )
  }
}

function decryptBankValue(value, privateKey) {
  if (value === null || value === undefined || value === '') {
    return ''
  }

  try {
    return privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      Buffer.from(String(value), 'base64')
    ).toString('utf8')
  } catch {
    throw new BancoAztecaError(
      'No fue posible descifrar un campo de la cartera',
      { code: 'BAZ_DECRYPT_ERROR' }
    )
  }
}

module.exports = {
  createBankPrivateKey,
  decryptBankValue
}
