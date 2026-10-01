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
import { signBytes } from '@solana/keys'
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

const BIP_44_SOL_DERIVATION_PATH_PREFIX = "m/44'/501'"

/**
 * Signer implementation that derives keys from a BIP-39 seed using a SLIP-0010 path.
 *
 * @implements {ISignerSolana}
 */
export default class SeedSignerSolana {
  /**
   * Creates a new seed signer.
   *
   * @param {string | Uint8Array} seed - A [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) mnemonic seed phrase, or a raw BIP-32 master seed (16-64 bytes).
   * @param {string} [path] - An absolute SLIP-0010 path; every segment must be hardened (default: "m/44'/501'").
   * @throws {ValueError} If the seed phrase is invalid, or if the path is not absolute or not fully hardened.
   */
  constructor (seed, path = BIP_44_SOL_DERIVATION_PATH_PREFIX) {
    if (typeof seed === 'string') {
      if (!bip39.validateMnemonic(seed)) {
        throw new ValueError('The seed phrase is invalid.')
      }
      seed = bip39.mnemonicToSeedSync(seed)
    }

    if (path !== 'm') {
      if (!path.startsWith('m/')) {
        throw new ValueError('The derivation path must be absolute (e.g. "m/44\'/501\'").')
      }

      assertFullHardenedPath(path.slice(2))
    }

    this._init(HDKey.fromMasterSeed(seed).derive(path, true), path)
  }

  /**
   * Binds the signer to an HD node.
   *
   * @private
   * @param {HDKey} node - The HD node at the signer's path.
   * @param {string} path - The signer's absolute path.
   */
  _init (node, path) {
    /** @private */
    this._node = node

    /** @private */
    this._path = path

    /**
     * The solana keypair, created on first use.
     *
     * @private
     * @type {KeyPairSigner | undefined}
     */
    this._account = undefined

    /**
     * Raw Ed25519 private key bytes (32 bytes).
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    this._rawPrivateKey = node.privateKey

    /**
     * Raw Ed25519 public key bytes (32 bytes).
     *
     * @private
     * @type {Uint8Array}
     */
    this._rawPublicKey = curve.getPublicKey(node.privateKey)

    /** @private */
    this._address = getAddressDecoder().decode(this._rawPublicKey)
  }

  /**
   * Whether this signer can derive child signers. Always true: every seed signer holds an
   * HD node and can derive below its own path.
   *
   * @type {true}
   */
  get isDerivable () {
    return true
  }

  /**
   * The signer's absolute derivation path.
   *
   * @type {string}
   */
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
    if (!this._account) {
      this._account = await createKeyPairSignerFromPrivateKeyBytes(this._rawPrivateKey)
    }

    return this._account
  }

  /**
   * Derives a child signer relative to this signer's own path (e.g. calling derive("0'/0'") on
   * a signer at "m/44'/501'" yields a child at "m/44'/501'/0'/0'").
   *
   * @param {string} relPath - The path segment to derive, relative to this signer's own path.
   * @returns {Promise<SeedSignerSolana>} The derived child signer.
   * @throws {ValueError} If the path is not fully hardened.
   */
  async derive (relPath) {
    assertFullHardenedPath(relPath)

    const signer = Object.create(SeedSignerSolana.prototype)
    signer._init(this._node.derive(`m/${relPath}`, true), `${this._path}/${relPath}`)

    return signer
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
    this._node = undefined
    this._account = undefined
  }
}
