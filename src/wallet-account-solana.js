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

import {
  assertIsFullySignedTransaction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  getTransactionEncoder
} from '@solana/transactions'
import { getCompiledTransactionMessageDecoder, setTransactionMessageFeePayer } from '@solana/transaction-messages'
import { address } from '@solana/addresses'
import { getBase64Decoder } from '@solana/codecs'

import { AssertionError, MaximumFeeExceededError, ProviderRequiredError, ValueError } from '@tetherto/wdk-wallet'

import WalletAccountReadOnlySolana from './wallet-account-read-only-solana.js'
import SeedSignerSolana from './signers/seed-signer-solana.js'

/**
 * @template TSignedTransaction
 * @typedef {import('@tetherto/wdk-wallet').IWalletAccount<TSignedTransaction>} IWalletAccount
 */
/** @typedef {import('@tetherto/wdk-wallet').KeyPair} KeyPair */
/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferOptions} TransferOptions */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */

/** @typedef {import('./wallet-account-read-only-solana.js').SolanaTransferOptions} SolanaTransferOptions */

/** @typedef {import('@solana/errors').SolanaError} SolanaError */

/** @typedef {import('./wallet-account-read-only-solana.js').SolanaTransaction} SolanaTransaction */
/** @typedef {import('./wallet-account-read-only-solana.js').SolanaWalletConfig} SolanaWalletConfig */

/** @typedef {import('@solana/transactions').Transaction} Transaction */
/** @typedef {import('@solana/transactions').FullySignedTransaction} FullySignedTransaction */

/** @typedef {import('./signers/signer-solana.js').ISignerSolana} ISignerSolana */

/** @implements {IWalletAccount<FullySignedTransaction>} */
export default class WalletAccountSolana extends WalletAccountReadOnlySolana {
  /**
   * Creates a new solana wallet account from a signer.
   *
   * @overload
   * @param {ISignerSolana} signer - The solana signer, derived to an account path.
   * @param {SolanaWalletConfig} [config] - The configuration object.
   * @throws {ValueError} If the signer is missing or is a root signer.
   */

  /**
   * Creates a new solana wallet account from a seed.
   *
   * @overload
   * @param {string | Uint8Array} seed - A [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) mnemonic seed phrase, or a raw BIP-32 master seed (16-64 bytes).
   * @param {string} path - The SLIP-0010 derivation path (e.g. "0'/0'/0'").
   * @param {SolanaWalletConfig} [config] - The configuration object.
   * @throws {ValueError} If the seed phrase is not a valid BIP-39 seed phrase.
   */
  constructor (seedOrSigner, pathOrConfig, config = {}) {
    let signer = seedOrSigner

    if (typeof seedOrSigner === 'string' || seedOrSigner instanceof Uint8Array) {
      signer = new SeedSignerSolana(seedOrSigner).derive(pathOrConfig)
    } else {
      config = pathOrConfig ?? {}
    }

    if (!signer) {
      throw new ValueError('A signer is required.')
    }

    if (signer.isRoot) {
      throw new ValueError('The signer is the root signer. Call derive method to create a child signer.')
    }

    super(undefined, config)

    /**
     * The wallet account configuration.
     *
     * @protected
     * @type {SolanaWalletConfig}
     */
    this._config = config

    /**
     * The solana signer.
     *
     * @private
     * @type {ISignerSolana}
     */
    this._signer = signer

    /**
     * @private
     */
    this._disposed = false
  }

  /**
   * Creates a new solana wallet account.
   *
   * @deprecated
   * @param {string | Uint8Array} seed - A [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) mnemonic seed phrase, or a raw BIP-32 master seed (16-64 bytes).
   * @param {string} path - The SLIP-0010 derivation path (e.g. "0'/0'/0'").
   * @param {SolanaWalletConfig} [config] - The configuration object.
   * @returns {Promise<WalletAccountSolana>} The wallet account.
   */
  static async at (seed, path, config = {}) {
    return new WalletAccountSolana(seed, path, config)
  }

  /**
   * The derivation path's index of this account.
   *
   * @type {number}
   */
  get index () {
    return this._signer.index
  }

  /**
   * The derivation path of this account.
   *
   * @type {string}
   */
  get path () {
    return this._signer.path
  }

  /**
   * The account's key pair.
   *
   * The uint8 arrays are bound to the wallet account, so any external change will reflect to the internal representation. For this reason,
   * it's strongly recommended to treat the key pair as a read-only view of the keys. While it's still technically possible to alter their
   * content, client code should never do so.
   *
   * @type {KeyPair}
   */
  get keyPair () {
    return this._signer.keyPair
  }

  /**
   * The address of this account.
   *
   * @returns {Promise<string>} The address.
   */
  async getAddress () {
    return await this._signer.getAddress()
  }

  /**
   * Signs a message.
   *
   * @param {string} message - The message to sign.
   * @returns {Promise<string>} The message's signature.
   * @throws {AssertionError} If the wallet account has been disposed.
   */
  async sign (message) {
    if (this._disposed) {
      throw new AssertionError('The wallet account has been disposed.')
    }

    return await this._signer.sign(message)
  }

  /**
   * Verifies a message's signature.
   *
   * @param {string} message - The original message.
   * @param {string} signature - The signature to verify.
   * @returns {Promise<boolean>} True if the signature is valid.
   */
  async verify (message, signature) {
    return await this._signer.verify(message, signature)
  }

  /**
   * Signs a transaction.
   *
   * @param {SolanaTransaction} tx - The transaction to sign: an unsigned transaction or a base64-encoded serialized transaction.
   * @returns {Promise<FullySignedTransaction>} The signed transaction.
   * @throws {AssertionError} If the wallet account has been disposed.
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   * @throws {MaximumFeeExceededError} If the transaction's cost exceeds the maximum transaction fee option.
   */
  async signTransaction (tx) {
    if (this._disposed) {
      throw new AssertionError('The wallet account has been disposed.')
    }

    if (!this._rpc) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to sign transactions.')
    }

    if (typeof tx === 'string') {
      const transaction = await this._signSerializedTransaction(tx)

      if (this._config.transactionMaxFee !== undefined) {
        const fee = await this._getSignedTransactionFee(transaction)
        if (fee > this._config.transactionMaxFee) {
          throw new MaximumFeeExceededError('Exceeded maximum fee cost for transaction operation.')
        }
      }

      return transaction
    }

    const transactionMessage = await this._prepareTransactionMessage(tx)

    if (this._config.transactionMaxFee !== undefined) {
      const fee = await this._getTransactionFee(transactionMessage)
      if (fee > this._config.transactionMaxFee) {
        throw new MaximumFeeExceededError('Exceeded maximum fee cost for transaction operation.')
      }
    }

    return await this._signTransactionMessage(transactionMessage)
  }

  /**
   * Quotes the costs of a send transaction operation.
   *
   * @param {SolanaTransaction | FullySignedTransaction} tx - The transaction. Either an unsigned transaction, an already-signed transaction, or a base64-encoded serialized transaction.
   * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   */
  async quoteSendTransaction (tx) {
    if (typeof tx === 'string') {
      tx = this._decodeSerializedTransaction(tx)
    }

    if (this._isSignedTransaction(tx)) {
      if (!this._rpc) {
        throw new ProviderRequiredError('The wallet must be connected to a provider to quote transactions.')
      }

      const fee = await this._getSignedTransactionFee(tx)

      return { fee }
    }

    return await super.quoteSendTransaction(tx)
  }

  /**
   * Sends a transaction.
   *
   * @param {SolanaTransaction | FullySignedTransaction} tx - The transaction. Either an unsigned transaction, an already-signed transaction, or a base64-encoded serialized transaction.
   * @returns {Promise<TransactionResult>} The transaction's result.
   * @throws {AssertionError} If the wallet account has been disposed.
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   * @throws {MaximumFeeExceededError} If the transaction's cost exceeds the maximum transaction fee option.
   */
  async sendTransaction (tx) {
    if (this._disposed) {
      throw new AssertionError('The wallet account has been disposed.')
    }

    if (!this._rpc) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to send transactions.')
    }

    if (typeof tx === 'string') {
      tx = await this._signSerializedTransaction(tx)
    }

    if (this._isSignedTransaction(tx)) {
      const { fee } = await this.quoteSendTransaction(tx)

      if (this._config.transactionMaxFee !== undefined && fee > this._config.transactionMaxFee) {
        throw new MaximumFeeExceededError('Exceeded maximum fee cost for transaction operation.')
      }

      const hash = await this._broadcastSignedTransaction(tx)

      return { hash, fee }
    }

    const transactionMessage = await this._prepareTransactionMessage(tx)

    const fee = await this._getTransactionFee(transactionMessage)

    if (this._config.transactionMaxFee !== undefined && fee > this._config.transactionMaxFee) {
      throw new MaximumFeeExceededError('Exceeded maximum fee cost for transaction operation.')
    }

    const hash = await this._sendTransactionMessage(transactionMessage)

    return { hash, fee }
  }

  /** @private */
  async _sendTransactionMessage (transactionMessage) {
    const signedTransaction = await this._signTransactionMessage(transactionMessage)
    return await this._broadcastSignedTransaction(signedTransaction)
  }

  /** @private */
  async _signTransactionMessage (transactionMessage) {
    return await this._signCompiledTransaction(compileTransaction(transactionMessage))
  }

  /**
   * Has the signer add its signature to a compiled transaction.
   *
   * @private
   * @param {Transaction} transaction - The compiled transaction.
   * @returns {Promise<FullySignedTransaction>} The signed transaction.
   * @throws {SolanaError} With code `SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING` if the transaction still misses signatures the account cannot provide.
   */
  async _signCompiledTransaction (transaction) {
    const unsignedBytes = Uint8Array.from(getTransactionEncoder().encode(transaction))
    const signedBytes = await this._signer.signTransaction(unsignedBytes)
    const signedTransaction = getTransactionDecoder().decode(signedBytes)

    assertIsFullySignedTransaction(signedTransaction)

    return signedTransaction
  }

  /** @private */
  async _broadcastSignedTransaction (signedTransaction) {
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction)
    return await this._rpc.sendTransaction(encodedTransaction, { encoding: 'base64' }).send()
  }

  /**
   * Determines whether a value is an already-signed transaction (as returned by `signTransaction`)
   * rather than an unsigned {@link SolanaTransaction}.
   *
   * @protected
   * @param {SolanaTransaction | FullySignedTransaction} tx - The transaction to inspect.
   * @returns {boolean} True if the value is a signed transaction.
   */
  _isSignedTransaction (tx) {
    return tx !== null &&
      typeof tx === 'object' &&
      tx.messageBytes !== undefined &&
      tx.signatures !== undefined
  }

  /**
   * Signs a base64-encoded serialized transaction (e.g. a swap or bridge payload built
   * by an external API) with the account's signer.
   *
   * @protected
   * @param {string} serializedTransaction - The base64-encoded serialized transaction.
   * @returns {Promise<FullySignedTransaction>} The signed transaction.
   * @throws {ValueError} If the transaction's fee payer is not the account.
   * @throws {SolanaError} With code `SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING` if the transaction still misses signatures the account cannot provide.
   */
  async _signSerializedTransaction (serializedTransaction) {
    const transaction = this._decodeSerializedTransaction(serializedTransaction)

    const { staticAccounts } = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
    const ownerAddress = await this.getAddress()
    if (staticAccounts[0] !== ownerAddress) {
      throw new ValueError(`Transaction fee payer (${staticAccounts[0]}) does not match wallet address (${ownerAddress})`)
    }

    return await this._signCompiledTransaction(transaction)
  }

  /**
   * Calculates the fee for an already-signed transaction.
   *
   * @protected
   * @param {FullySignedTransaction} signedTransaction - The signed transaction.
   * @returns {Promise<bigint>} The calculated transaction fee in lamports.
   */
  async _getSignedTransactionFee (signedTransaction) {
    const base64EncodedMessage = getBase64Decoder().decode(signedTransaction.messageBytes)

    return await this._getFeeForBase64Message(base64EncodedMessage)
  }

  /** @private */
  async _prepareTransactionMessage (tx) {
    let transactionMessage = tx

    if (tx.to !== undefined && tx.value !== undefined) {
      transactionMessage = await this._buildNativeTransferTransactionMessage(tx.to, tx.value)
    }

    if (Array.isArray(transactionMessage.instructions)) {
      transactionMessage = await this._ensureLifetime(transactionMessage)
      await this._assertFeePayer(transactionMessage)
      transactionMessage = setTransactionMessageFeePayer(address(await this.getAddress()), transactionMessage)
    }

    return transactionMessage
  }

  /**
   * Transfers a token to another address.
   *
   * @param {TransferOptions} options - The transfer's options.
   * @param {SolanaTransferOptions} [solanaOptions] - The transfer's Solana-specific options.
   * @returns {Promise<TransferResult>} The transfer's result.
   * @throws {AssertionError} If the wallet account has been disposed.
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   * @throws {MaximumFeeExceededError} If the transfer's cost exceeds the maximum transfer fee option.
   * @note only SPL tokens - won't work for native SOL
   */
  async transfer (options, solanaOptions = {}) {
    if (this._disposed) {
      throw new AssertionError('The wallet account has been disposed.')
    }

    if (!this._rpc) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to transfer tokens.')
    }

    const { token, recipient, amount } = options

    const transactionMessage = await this._buildSPLTransferTransactionMessage(token, recipient, amount, solanaOptions)
    const fee = await this._getTransactionFee(transactionMessage)
    if (this._config.transferMaxFee !== undefined && fee > this._config.transferMaxFee) {
      throw new MaximumFeeExceededError('Exceeded maximum fee cost for transfer operation.')
    }

    const preparedMessage = await this._prepareTransactionMessage(transactionMessage)
    const hash = await this._sendTransactionMessage(preparedMessage)

    return { hash, fee }
  }

  /**
   * Returns a read-only copy of the account.
   *
   * @returns {Promise<WalletAccountReadOnlySolana>} The read-only account.
   */
  async toReadOnlyAccount () {
    if (!this._solanaReadOnlyAccount) {
      const address = await this.getAddress()
      this._solanaReadOnlyAccount = new WalletAccountReadOnlySolana(address, { ...this._config, provider: this._rpc })
    }

    return this._solanaReadOnlyAccount
  }

  /**
   * Disposes the wallet account, erasing the private key from the memory.
   */
  dispose () {
    this._signer.dispose()
    this._disposed = true
  }
}
