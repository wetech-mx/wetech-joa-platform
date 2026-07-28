const test = require('node:test')
const assert = require('node:assert/strict')
const {
  constants,
  generateKeyPairSync,
  publicEncrypt
} = require('node:crypto')

const {
  createBankPrivateKey,
  decryptBankValue
} = require('../integrations/banco-azteca/crypto')

function testKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  })

  return {
    privateKeyBase64: privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64'),
    encrypt(value) {
      return publicEncrypt(
        {
          key: publicKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        Buffer.from(value, 'utf8')
      ).toString('base64')
    }
  }
}

test('descifra RSA OAEP SHA-256 compatible con el programa original', () => {
  const keys = testKeys()
  const privateKey = createBankPrivateKey(keys.privateKeyBase64)
  const encrypted = keys.encrypt('5550001234')

  assert.equal(
    decryptBankValue(encrypted, privateKey),
    '5550001234'
  )
})

test('rechaza datos que no pueden descifrarse en vez de exponerlos', () => {
  const keys = testKeys()
  const privateKey = createBankPrivateKey(keys.privateKeyBase64)

  assert.throws(
    () => decryptBankValue('dato-no-cifrado', privateKey),
    error => error.code === 'BAZ_DECRYPT_ERROR'
  )
})

module.exports = {
  testKeys
}
