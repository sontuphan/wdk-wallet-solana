// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import * as bip39 from 'bip39'
import HDKey from 'micro-key-producer/slip10.js'
import { verifySignature, signBytes } from '@solana/keys'
import { getAddressDecoder } from '@solana/addresses'
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/signers'
import { getTransactionDecoder, getTransactionEncoder, partiallySignTransaction } from '@solana/transactions'

// eslint-disable-next-line camelcase
import { sodium_memzero } from 'sodium-universal'

import * as curve from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

import { ValueError } from '@tetherto/wdk-wallet'

import { assertFullHardenedPath } from './signer-solana.js'

// To enable @noble's synchronous methods
curve.hashes.sha512 = sha512

/**
 * @typedef {import("./signer-solana.js").ISignerSolana} ISignerSolana
 */

/** @typedef {import('@tetherto/wdk-wallet').KeyPair} KeyPair */
/** @typedef {import('micro-key-producer/slip10.js').HDKey} HDKey */
/** @typedef {import('@solana/signers').KeyPairSigner} KeyPairSigner */

/**
 * @typedef {Object} SeedSignerSolOpts
 * @property {HDKey} [root] The root node that can be provided alternatively to the seed.
 * @property {string} [path] The BIP-44 derivation path (e.g. "0'/0'"). Note that, All child paths must be hardened in Solana.
 */

/**
 * @typedef {Object} SeedSignerSolCfg
 */

const BIP_44_SOL_DERIVATION_PATH_PREFIX = "m/44'/501'"

/**
 * @implements {ISignerSolana}
 */
export default class SeedSignerSolana {
  /**
   * @constructor
   * @param {string | Uint8Array | null} seed A [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) mnemonic seed phrase, or a raw BIP-32 master seed (16-64 bytes).
   * @param {SeedSignerSolCfg} [config] The signer configuration.
   * @param {SeedSignerSolOpts} [opts] Optional constructor dependencies.
   * @throws {ValueError} If both or neither of a seed and a root are given, if the seed phrase is invalid, or if the path is not fully hardened.
   */
  constructor (seed, config = {}, opts = {}) {
    if (opts.root && seed) {
      throw new ValueError('Provide either a seed or a root, not both.')
    }

    if (!opts.root && !seed) {
      throw new ValueError('Seed or root is required.')
    }

    if (typeof seed === 'string') {
      if (!bip39.validateMnemonic(seed)) {
        throw new ValueError('The seed phrase is invalid.')
      }
      seed = bip39.mnemonicToSeedSync(seed)
    }

    /** @private */
    this._config = config

    /** @private */
    this._isRoot = true

    /** @private */
    this._root =
      opts.root ||
      (seed ? HDKey.fromMasterSeed(seed).derive(BIP_44_SOL_DERIVATION_PATH_PREFIX) : undefined)

    /**
     * The solana keypair, created on first use.
     *
     * @private
     * @type {KeyPairSigner | undefined}
     */
    this._account = undefined

    /** @private */
    this._address = undefined

    /** @private */
    this._path = undefined

    /**
     * Raw Ed25519 public key bytes (32 bytes).
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    this._rawPublicKey = undefined

    /**
     * Raw Ed25519 private key bytes (32 bytes).
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    this._rawPrivateKey = undefined

    if (opts.path) {
      assertFullHardenedPath(opts.path)

      this._path = `${BIP_44_SOL_DERIVATION_PATH_PREFIX}/${opts.path}`
      this._isRoot = false

      const { privateKey } = this._root.derive(`m/${opts.path}`, true)

      this._rawPrivateKey = privateKey
      this._rawPublicKey = curve.getPublicKey(privateKey)
      this._address = getAddressDecoder().decode(this._rawPublicKey)
    }
  }

  get config () {
    return this._config
  }

  get isRoot () {
    return this._isRoot
  }

  get isDerivable () {
    return true
  }

  get index () {
    if (!this._path) return undefined
    return +this._path.replace(/'/g, '').split('/').at(3)
  }

  get path () {
    return this._path
  }

  /**
   * The account's key pair.
   *
   * Returns the raw key pair bytes in standard Solana format.
   * - privateKey: 32-byte Ed25519 secret key (Uint8Array), or null once disposed
   * - publicKey: 32-byte Ed25519 public key (Uint8Array)
   *
   * @type {KeyPair}
   */
  get keyPair () {
    return {
      privateKey: this._rawPrivateKey ?? null,
      publicKey: this._rawPublicKey
    }
  }

  /**
   * Creates the {@link KeyPairSigner} from the raw private key on first use.
   *
   * @private
   * @returns {Promise<KeyPairSigner>} The key pair signer.
   */
  async _getAccount () {
    if (!this._rawPrivateKey) {
      throw new ValueError('Not allowed to interact with the root node.')
    }

    if (!this._account) {
      this._account = await createKeyPairSignerFromPrivateKeyBytes(this._rawPrivateKey)
    }

    return this._account
  }

  derive (relPath, config = {}) {
    const merged = {
      ...this._config,
      ...Object.fromEntries(Object.entries(config || {}).filter(([, v]) => v !== undefined))
    }
    return new SeedSignerSolana(null, merged, {
      root: this._root,
      path: relPath
    })
  }

  async getAddress () {
    return this._address
  }

  async sign (message) {
    const account = await this._getAccount()

    const messageBytes = Buffer.from(message, 'utf8')
    const signatureBytes = await signBytes(account.keyPair.privateKey, messageBytes)

    return Buffer.from(signatureBytes).toString('hex')
  }

  async verify (message, signature) {
    const account = await this._getAccount()

    const messageBytes = Buffer.from(message, 'utf8')
    const signatureBytes = Buffer.from(signature, 'hex')

    return await verifySignature(account.keyPair.publicKey, signatureBytes, messageBytes)
  }

  async signTransaction (unsignedTx) {
    const account = await this._getAccount()

    const tx = getTransactionDecoder().decode(unsignedTx)
    const signedTransaction = await partiallySignTransaction([account.keyPair], tx)

    return Uint8Array.from(getTransactionEncoder().encode(signedTransaction))
  }

  dispose () {
    if (this._rawPrivateKey) {
      sodium_memzero(this._rawPrivateKey)
    }

    this._rawPrivateKey = undefined
    this._root = undefined
    this._account = undefined
  }
}
