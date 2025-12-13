'use strict'

import { NotImplementedError } from '@tetherto/wdk-wallet'
import * as bip39 from 'bip39'
import HDKey from 'micro-key-producer/slip10.js'
import { verifySignature, signBytes } from '@solana/keys'
import {
  createKeyPairSignerFromPrivateKeyBytes,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners
} from '@solana/signers'
import {
  getBase64EncodedWireTransaction,
  getTransactionDecoder
} from '@solana/transactions'
import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder
} from '@solana/transaction-messages'

// eslint-disable-next-line camelcase
import { sodium_memzero } from 'sodium-universal'

/** @typedef {import('@tetherto/wdk-wallet').KeyPair} KeyPair */
/** @typedef {import('micro-key-producer/slip10.js').HDKey} HDKey */
/** @typedef {import('@solana/signers').KeyPairSigner} KeyPairSigner */

const BIP_44_SOL_DERIVATION_PATH_PREFIX = "m/44'/501'"

export class ISignerSolana {
  /**
   * The flag indicates whether the signer is ready to use.
   *
   * @type {boolean}
   */
  get isActive () {
    throw new NotImplementedError('isActive')
  }

  /**
   * The derivation path's index of this account.
   *
   * @type {number}
   */
  get index () {
    throw new NotImplementedError('index')
  }

  /**
   * The derivation path of this account.
   *
   * @type {string}
   */
  get path () {
    throw new NotImplementedError('path')
  }

  /**
   * The signer config.
   *
   * @type {object}
   */
  get config () {
    throw new NotImplementedError('config')
  }

  /**
   * The account address.
   *
   * @type {string}
   */
  get address () {
    throw new NotImplementedError('address')
  }

  /**
   * The account's key pair.
   *
   * Returns the raw key pair bytes in standard Solana format.
   * - privateKey: 32-byte Ed25519 secret key (Uint8Array)
   * - publicKey: 32-byte Ed25519 public key (Uint8Array)
   *
   * @type {KeyPair}
   */
  get keyPair () {
    throw new NotImplementedError('keyPair')
  }

  /**
   * Derive a child account.
   *
   * @param {string} relPath - The relative path.
   * @param {object} config - The config.
   * @returns {ISignerSolana} The child implementation of ISignerSolana.
   */
  derive (relPath, config = {}) {
    throw new NotImplementedError('derive(relPath, config = {})')
  }

  /**
   * Signs a message.
   *
   * @param {string} message - The message to sign.
   * @returns {Promise<string>} The message's signature.
   */
  async sign (message) {
    throw new NotImplementedError('sign(message)')
  }

  /**
   * Verifies a message's signature.
   *
   * @param {string} message - The original message.
   * @param {string} signature - The signature to verify.
   * @returns {Promise<boolean>} True if the signature is valid.
   */
  async verify (message, signature) {
    throw new NotImplementedError('verify(message, signature)')
  }

  /**
   * Sign a transaction
   *
   * @param {Uint8Array} unsignedTx - The unsigned transaction.
   * @returns {Promise<Uint8Array>} The signed transaction.
   */
  async signTransaction (unsignedTx) {
    throw new NotImplementedError('signTransaction(unsignedTx)')
  }

  /**
   * Disposes the wallet account, erasing the private key from the memory.
   */
  dispose () {
    throw new NotImplementedError('dispose()')
  }
}

/**
 * @implements {ISignerSolana}
 */
export default class SeedSignerSolana {
  constructor (seed, config = {}, opts = {}) {
    if (opts.root && seed) {
      throw new Error('Provide either a seed or a root, not both.')
    }

    if (!opts.root && !seed) {
      throw new Error('Seed or root is required.')
    }

    if (typeof seed === 'string') {
      if (!bip39.validateMnemonic(seed)) {
        throw new Error('The seed phrase is invalid.')
      }
      seed = bip39.mnemonicToSeedSync(seed)
    }

    this._config = config
    this._isRoot = true
    this._root =
      opts.root ||
      (seed
        ? HDKey.fromMasterSeed(seed).derive(BIP_44_SOL_DERIVATION_PATH_PREFIX)
        : undefined)

    /**
     * The solana keypair
     * @private
     * @type {KeyPairSigner | undefined}
     */
    this._account = undefined

    /**
     * The solana base58 address
     * @private
     * @type {string | undefined}
     */
    this._address = undefined

    this._path = undefined
    this._isActive = false
    this._rawPublicKey = undefined
    this._rawPrivateKey = undefined

    if (opts.path) {
      this._initAccount(this._root, opts.path) // This is an async process, which requires checking `isActive` to ensure the complete construction.
      this._path = `${BIP_44_SOL_DERIVATION_PATH_PREFIX}/${opts.path}`
      this._isRoot = false
    }
  }

  /**
   * Sign a transaction
   *
   * @private
   * @param {HDKey} root - The root HDKey at m/44'/501'.
   * @param {string} relPath - The relative derivation path (e.g. 0'/0/0).
   * @returns {Promise<void>} Void.
   */
  async _initAccount (root, relPath) {
    const { privateKey } = root.derive(`m/${relPath}`, true)

    const account = await createKeyPairSignerFromPrivateKeyBytes(privateKey)

    this._account = account
    this._address = this._account.address
    this._isActive = true

    const publicKey = await crypto.subtle.exportKey(
      'raw',
      account.keyPair.publicKey
    )

    this._rawPublicKey = new Uint8Array(publicKey)
    this._rawPrivateKey = new Uint8Array(privateKey)

    sodium_memzero(privateKey)
  }

  get isActive () {
    return this._isActive
  }

  get isRoot () {
    return this._isRoot
  }

  get index () {
    const segments = this.path.split('/')
    return +segments[3].replace("'", '')
  }

  get path () {
    return this._path
  }

  get address () {
    return this._address
  }

  get keyPair () {
    return {
      privateKey: this._rawPrivateKey,
      publicKey: this._rawPublicKey
    }
  }

  derive (relPath, config = {}) {
    const merged = {
      ...this._config,
      ...Object.fromEntries(
        Object.entries(config || {}).filter(([, v]) => v !== undefined)
      )
    }
    return new SeedSignerSolana(null, merged, {
      root: this._root,
      path: relPath
    })
  }

  async sign (message) {
    if (!this._account) {
      throw new Error('The wallet account has been disposed.')
    }
    const messageBytes = Buffer.from(message, 'utf8')
    const signatureBytes = await signBytes(
      this._account.keyPair.privateKey,
      messageBytes
    )
    const signature = Buffer.from(signatureBytes).toString('hex')

    return signature
  }

  async verify (message, signature) {
    const messageBytes = Buffer.from(message, 'utf8')
    const signatureBytes = Buffer.from(signature, 'hex')

    const isValid = await verifySignature(
      this._account.keyPair.publicKey,
      signatureBytes,
      messageBytes
    )

    return isValid
  }

  async signTransaction (unsignedTx) {
    if (!this._account) {
      throw new Error(
        'Cannot sign transactions from a root signer. Derive a child first.'
      )
    }

    const tx = getTransactionDecoder().decode(unsignedTx)
    const compiledTransactionMessage =
      getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
    const readonlyTransactionMessage = decompileTransactionMessage(
      compiledTransactionMessage
    )
    const transactionMessage = setTransactionMessageFeePayerSigner(
      this._account,
      readonlyTransactionMessage
    )
    const signedTransaction = await signTransactionMessageWithSigners(
      transactionMessage
    )

    return Buffer.from(
      getBase64EncodedWireTransaction(signedTransaction),
      'base64'
    )
  }

  dispose () {
    sodium_memzero(this._rawPrivateKey)
    this._root = undefined
    this._account = undefined
    this._address = undefined
    this._path = undefined
    this._isActive = false
  }
}
