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

import { createSolanaRpc } from '@solana/kit'
import WalletAccountSolana from './wallet-account-solana.js'
import sodium from 'sodium-universal'
import AbstractWalletManager from '@wdk/wallet'

const FEE_RATE_NORMAL_MULTIPLIER = 1.1
const FEE_RATE_FAST_MULTIPLIER = 2.0

/** @typedef {import('./wallet-account-solana.js').SolanaWalletConfig} SolanaWalletConfig */
/** @typedef {import('@wdk/wallet').FeeRates} FeeRates */

export default class WalletManagerSolana extends AbstractWalletManager {
  /**
   * @private
   */
  _rpc
  /**
   * @private
   */
  _rpcUrl
  /**
   * @private
   */
  _wsUrl
  /**
   * @private
   */
  _accounts

  /**
   * Creates a new wallet manager for solana blockchains.
   *
   * @param {string|Uint8Array} seed - The wallet's seed, either as a [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase or a Uint8Array.
   * @param {SolanaWalletConfig} [config] - The configuration object.
   */
  constructor (seed, config = {}) {
    super(seed, config)

    this._accounts = new Set()

    const { rpcUrl, wsUrl } = config

    if (rpcUrl) {
      this._rpcUrl = rpcUrl
      this._rpc = createSolanaRpc(rpcUrl)
    }

    if (wsUrl) {
      this._wsUrl = wsUrl
    } else if (rpcUrl) {
      this._wsUrl = rpcUrl.replace('http', 'ws')
    }
  }

  /**
   * Returns the wallet account at a specific index (see [BIP-44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)).
   *
   * @example
   * // Returns the account with derivation path m/44'/501'/1'/0'
   * const account = await wallet.getAccount(1);
   * @param {number} [index] - The index of the account to get (default: 0).
   * @returns {Promise<WalletAccountSolana>} The account.
   */
  async getAccount (index = 0) {
    return await this.getAccountByPath(`${index}'/0'`)
  }

  /**
   * Returns the wallet account at a specific BIP-44 derivation path.
   *
   * @example
   * // Returns the account with derivation path m/44'/501'/0'/0'
   * const account = await wallet.getAccountByPath("/1'/0'"");
   * @param {string} path - The derivation path (e.g. "/1'/0'").
   * @returns {Promise<WalletAccountSolana>} The account.
   */
  async getAccountByPath (path) {
    const account = await WalletAccountSolana.create(this.seed, path, {
      rpcUrl: this._rpcUrl,
      wsUrl: this._wsUrl
    })

    this._accounts.add(account)

    return account
  }

  /**
   * Returns the current fee rates.
   *
   * @returns {Promise<{FeeRates>} The fee rates.
   */
  async getFeeRates () {
    if (!this._rpc) {
      throw new Error(
        'The wallet must be connected to a provider to get fee rates.'
      )
    }

    // Get recent prioritization fees
    const fees = await this._rpc.getRecentPrioritizationFees().send()

    // Find the highest non-zero fee, or use default
    const nonZeroFees = fees.filter(fee => fee.prioritizationFee > 0n)
    const baseFee = nonZeroFees.length > 0
      ? Number(nonZeroFees.reduce((max, fee) => fee.prioritizationFee > max ? fee.prioritizationFee : max, 0n))
      : 5000

    const normalFee = Math.round(baseFee * FEE_RATE_NORMAL_MULTIPLIER)
    const fastFee = Math.round(baseFee * FEE_RATE_FAST_MULTIPLIER)

    return {
      normal: normalFee,
      fast: fastFee
    }
  }

  /**
 * Disposes the wallet manager, erasing the seed buffer.
 */
  dispose () {
    for (const account of this._accounts) account.dispose()
    this._accounts.clear()

    sodium.sodium_memzero(this._seed)

    this._seed = null
    this._config = null
    this._rpc = null
    this._rpcUrl = null
    this._wsUrl = null
  }
}
