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

import { getAddressDecoder } from '@solana/addresses'
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/signers'

// eslint-disable-next-line camelcase
import { sodium_memzero } from 'sodium-universal'

import * as curve from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

import { UnsupportedOperationError, ValueError } from '@tetherto/wdk-wallet'

import { signMessage, signTransactionBytes } from './utils.js'

// To enable @noble's synchronous methods
curve.hashes.sha512 = sha512

/** @typedef {import('./signer-solana.js').ISignerSolana} ISignerSolana */
/** @typedef {import('@tetherto/wdk-wallet').KeyPair} KeyPair */
/** @typedef {import('@solana/signers').KeyPairSigner} KeyPairSigner */

/**
 * Signer backed by a single raw Ed25519 private key (non-HD).
 *
 * Does not support HD derivation. Signs messages and transactions directly with the key.
 *
 * @implements {ISignerSolana}
 */
export default class PrivateKeySignerSolana {
  /**
   * Creates a new private key signer.
   *
   * The supplied key is copied: the signer keeps its own internal copy alive until {@link dispose}
   * zeroes it, and never wipes the supplied key, whose disposal remains the caller's responsibility.
   *
   * @param {string | Uint8Array} privateKey - The raw Ed25519 private key (hex string or 32 bytes).
   * @throws {ValueError} If the private key is not 32 bytes.
   */
  constructor (privateKey) {
    privateKey = typeof privateKey === 'string'
      ? Uint8Array.from(Buffer.from(privateKey, 'hex'))
      : Uint8Array.from(privateKey)

    if (privateKey.length !== 32) {
      throw new ValueError('The private key must be 32 bytes.')
    }

    /**
     * Raw Ed25519 private key bytes (32 bytes), owned by the signer.
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    this._rawPrivateKey = privateKey

    /**
     * Raw Ed25519 public key bytes (32 bytes).
     *
     * @private
     * @type {Uint8Array}
     */
    this._rawPublicKey = curve.getPublicKey(privateKey)

    /** @private */
    this._address = getAddressDecoder().decode(this._rawPublicKey)

    /**
     * The solana keypair, created on first use.
     *
     * @private
     * @type {KeyPairSigner | undefined}
     */
    this._account = undefined
  }

  /**
   * Whether this signer can derive child signers.
   *
   * @type {false}
   */
  get isDerivable () {
    return false
  }

  /**
   * The derivation path. Always null for private-key signers.
   *
   * @type {null}
   */
  get path () {
    return null
  }

  /**
   * The account's key pair.
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
   * Derives a child signer using a relative path.
   *
   * @param {string} path - The relative derivation path.
   * @returns {Promise<never>} The derived signer.
   * @throws {UnsupportedOperationError} If the signer does not support account derivation.
   */
  async derive (path) {
    throw new UnsupportedOperationError('derive(path)')
  }

  async getAddress () {
    return this._address
  }

  async sign (message) {
    return await signMessage(await this._getAccount(), message)
  }

  async signTransaction (unsignedTx) {
    return await signTransactionBytes(await this._getAccount(), unsignedTx)
  }

  /**
   * Disposes the signer, securely erasing its internal copy of the private key from memory.
   */
  dispose () {
    if (this._rawPrivateKey) {
      sodium_memzero(this._rawPrivateKey)
    }

    this._rawPrivateKey = undefined
    this._account = undefined
  }
}
