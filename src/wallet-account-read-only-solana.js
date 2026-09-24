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

import { WalletAccountReadOnly, NoSuchElementError, ProviderRequiredError, ValueError } from '@tetherto/wdk-wallet'

import FailoverProvider from '@tetherto/wdk-failover-provider'

import { address, getPublicKeyFromAddress } from '@solana/addresses'
import { createSolanaRpc } from '@solana/rpc'
import { pipe } from '@solana/functional'
import {
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  getCompiledTransactionMessageEncoder,
  setTransactionMessageFeePayer,
  compileTransactionMessage,
  isTransactionMessageWithBlockhashLifetime,
  isTransactionMessageWithDurableNonceLifetime
} from '@solana/transaction-messages'
import { getTransactionDecoder, getTransactionMessageSize, TRANSACTION_SIZE_LIMIT } from '@solana/transactions'
import { getBase64Decoder, getBase64Encoder } from '@solana/codecs'
import { getTransferSolInstruction } from '@solana-program/system'
import { getAddMemoInstruction } from '@solana-program/memo'
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token'
import {
  AccountState,
  getCreateAssociatedTokenIdempotentInstruction as getCreateAssociatedToken2022IdempotentInstruction,
  getMintDecoder as getMint2022Decoder,
  getTokenDecoder as getToken2022Decoder,
  getTransferCheckedInstruction as getTransferChecked2022Instruction,
  TOKEN_2022_PROGRAM_ADDRESS
} from '@solana-program/token-2022'

import {
  ConfidentialTransferNotSupportedError,
  FrozenTokenAccountError,
  NonTransferableTokenError,
  RequiredMemoNotSupportedError,
  TransferHookNotSupportedError
} from './errors.js'
import { isSignature, verifySignature } from '@solana/keys'

/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferOptions} TransferOptions */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */
/** @typedef {import('@tetherto/wdk-wallet').TransactionReceipt} TransactionReceipt */
/** @typedef {import('@tetherto/wdk-wallet').WaitForTransactionOptions} WaitForTransactionOptions */

/** @typedef {import('@solana/addresses').Address} Address */
/** @typedef {import('@solana/codecs').ReadonlyUint8Array} ReadonlyUint8Array */
/** @typedef {import('@solana/transaction-messages').TransactionMessage} TransactionMessage */
/** @typedef {import('@solana/transactions').Transaction} Transaction */
/** @typedef {ReturnType<typeof import('@solana/rpc').createSolanaRpc>} SolanaRpc */
/** @typedef {ReturnType<import('@solana/rpc-api').SolanaRpcApi['getTransaction']>} SolanaTransactionReceipt */
/** @typedef {import('@solana/rpc-types').Commitment} Commitment */

/**
 * The Solana-specific fields added to a normalized transaction receipt.
 *
 * @typedef {Object} SolanaTransactionDetails
 * @property {number | null} confirmations - The number of confirmations, or null once the transaction is finalized (or when the node no longer reports a count).
 * @property {SolanaTransactionReceipt | null} transaction - The native Solana transaction object, or null while the transaction is pending.
 */

/**
 * The Solana-specific options of a transfer operation, next to the chain-agnostic {@link TransferOptions}.
 *
 * @typedef {Object} SolanaTransferOptions
 * @property {string} [memo] - A UTF-8 memo to attach to the transfer, ignored when empty. It has to be short enough for the transfer to stay within the maximum transaction size. Tokens whose recipient token account enables the memo transfer extension reject transfers that carry none, but that extension is Token-2022 only and this account does not transfer Token-2022 mints yet, so today the memo serves as a payment reference.
 */

/**
 * @typedef {Object} SimpleSolanaTransaction
 * @property {string} to - The recipient's Solana address.
 * @property {number | bigint} value - The amount of SOL to send in lamports (1 SOL = 1,000,000,000 lamports).
 */

/**
 * A transaction to operate on: a native transfer object, a transaction message, or a
 * base64-encoded serialized transaction (e.g. a swap or bridge payload built by an
 * external API).
 *
 * @typedef {SimpleSolanaTransaction | TransactionMessage | string} SolanaTransaction
 */

/**
 * @typedef {Object} SolanaWalletConfig
 * @property {string | SolanaRpc | Array<string | SolanaRpc>} [provider] - The Solana RPC url or an already-built Solana RPC client. It's also possible to provide an array of these instead. In such case, connection errors will cause the wallet to automatically fallback on the next provider in the list. An already-built client is reused as-is, which lets a manager share a single client across all the accounts it creates.
 * @property {string | string[]} [rpcUrl] - Deprecated alias for `provider`. If both are set, `provider` takes precedence.
 * @property {Commitment} [commitment] - The commitment level (default: 'confirmed').
 * @property {number} [retries] - If set and if 'provider' is a list of urls, the number of additional retry attempts after the initial call fails. Total attempts = `1 + retries`. For example, `retries: 3` with 4 providers will try each provider once before throwing. If `retries` exceeds the number of providers, the failover will loop back and retry already-failed providers in round-robin order (default: 3).
 * @property {number | bigint} [transferMaxFee] - Maximum allowed fee in lamports for transfer operations.
 * @property {number | bigint} [transactionMaxFee] - The maximum fee amount for sendTransaction and signTransaction operations.
 */

/**
 * A mint account, as fetched from the chain and cached by mint address.
 *
 * @typedef {Object} MintAccount
 * @property {Address} tokenProgram - The address of the token program owning the mint.
 * @property {ReadonlyUint8Array} data - The raw account data.
 */

const MAX_U64 = 0xffffffffffffffffn

/** The size, in bytes, of the base mint layout shared by both token programs. */
const MINT_SIZE = 82

/** The offset, in bytes, of the account type discriminator in a Token-2022 account. */
const TOKEN_2022_ACCOUNT_TYPE_OFFSET = 165

/** The account type discriminator of a Token-2022 mint. */
const TOKEN_2022_ACCOUNT_TYPE_MINT = 1

/** The maximum number of addresses the `getMultipleAccounts` RPC accepts per call. */
const MAX_ACCOUNTS_PER_REQUEST = 100

/**
 * The offset, in bytes, of the amount field in a token account. Token-2022 keeps the
 * classic base layout and appends its extensions after {@link TOKEN_2022_ACCOUNT_TYPE_OFFSET},
 * so this offset reads the amount of an account of either program.
 */
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64

/** The offset, in bytes, of the decimals field in a mint of either token program. */
const MINT_DECIMALS_OFFSET = 44

/**
 * The mint extensions a transfer is refused for, each mapped to the error it raises.
 * An entry returns `null` when the extension is present but harmless in its current
 * configuration. Every other extension, including the transfer fee and interest-bearing
 * ones, is transferred through unchanged.
 */
const REJECTED_MINT_EXTENSIONS = {
  NonTransferable: token =>
    new NonTransferableTokenError(`Token '${token}' is non-transferable.`),
  TransferHook: token =>
    new TransferHookNotSupportedError(`Token '${token}' carries a transfer hook, which is not supported.`),
  ConfidentialTransferMint: token =>
    new ConfidentialTransferNotSupportedError(`Token '${token}' is configured for confidential transfers, which are not supported.`),
  DefaultAccountState: (token, extension) => extension.state === AccountState.Frozen
    ? new FrozenTokenAccountError(`Token '${token}' freezes by default the accounts it creates.`)
    : null
}

/**
 * The instruction builders of each supported token program. The two programs share their
 * instruction layouts but not their addresses, so a transfer is built from the entry of
 * the program owning the mint.
 */
const TOKEN_PROGRAM_INSTRUCTIONS = {
  [TOKEN_PROGRAM_ADDRESS]: {
    createAssociatedTokenIdempotent: getCreateAssociatedTokenIdempotentInstruction,
    transferChecked: getTransferCheckedInstruction
  },
  [TOKEN_2022_PROGRAM_ADDRESS]: {
    createAssociatedTokenIdempotent: getCreateAssociatedToken2022IdempotentInstruction,
    transferChecked: getTransferChecked2022Instruction
  }
}

/**
 * Tells whether the data of an account owned by a token program is a mint.
 *
 * A classic SPL mint is exactly {@link MINT_SIZE} bytes. A Token-2022 mint is either the
 * same bare layout or, once it carries extensions, a longer account tagged with the mint
 * discriminator at {@link TOKEN_2022_ACCOUNT_TYPE_OFFSET}. That tag is what tells a mint
 * apart from a token account, which is otherwise indistinguishable by owner alone.
 *
 * @param {Address} tokenProgram - The address of the token program owning the account.
 * @param {ReadonlyUint8Array} data - The raw account data.
 * @returns {boolean} Whether the account is a mint.
 */
function isMintAccountData (tokenProgram, data) {
  if (data.length === MINT_SIZE) {
    return true
  }

  if (tokenProgram !== TOKEN_2022_PROGRAM_ADDRESS) {
    return false
  }

  return data.length > TOKEN_2022_ACCOUNT_TYPE_OFFSET &&
    data[TOKEN_2022_ACCOUNT_TYPE_OFFSET] === TOKEN_2022_ACCOUNT_TYPE_MINT
}

/**
 * Read-only Solana wallet account implementation.
 */
export default class WalletAccountReadOnlySolana extends WalletAccountReadOnly {
  /**
   * Creates a new solana read-only wallet account.
   *
   * @param {string} addr - The account's address.
   * @param {Omit<SolanaWalletConfig, 'transferMaxFee' | 'transactionMaxFee'>} [config] - The configuration object.
   */
  constructor (addr, config = {}) {
    super(addr)

    /**
     * The read-only wallet account configuration.
     *
     * @protected
     * @type {Omit<SolanaWalletConfig, 'transferMaxFee' | 'transactionMaxFee'>}
     */
    this._config = config

    const { commitment = 'confirmed' } = config

    /**
     * The commitment level for querying transaction and account states.
     * Determines the level of finality required before returning results.
     *
     * @protected
     * @type {Commitment}
     */
    this._commitment = commitment

    /**
     * A Solana RPC client for HTTP requests.
     *
     * @protected
     * @type {SolanaRpc | undefined}
     */
    this._rpc = WalletAccountReadOnlySolana._buildRpc(config)

    /**
     * The cache of mint accounts already fetched by this instance, keyed by mint address.
     * A mint never changes owner, so an entry is kept for the lifetime of the account.
     *
     * @protected
     * @type {Map<string, MintAccount>}
     */
    this._mintAccountCache = new Map()
  }

  /**
   * Builds a Solana RPC client from the wallet configuration: a url string, an already-built
   * client reused as-is, or a list of either (with connection errors failing over to the next).
   *
   * @protected
   * @param {Omit<SolanaWalletConfig, 'transferMaxFee' | 'transactionMaxFee'>} [config] - The configuration object.
   * @returns {SolanaRpc | undefined} The rpc client, or undefined if none is configured.
   */
  static _buildRpc (config = {}) {
    const { provider, rpcUrl, retries = 3 } = config
    const rpcTarget = provider ?? rpcUrl

    const toOption = (entry) => (typeof entry === 'string' ? createSolanaRpc(entry) : entry)

    if (Array.isArray(rpcTarget)) {
      if (rpcTarget.length === 0) {
        return undefined
      }

      const failoverProvider = new FailoverProvider({ retries })

      for (const entry of rpcTarget) {
        failoverProvider.addProvider(toOption(entry))
      }

      return failoverProvider.initialize()
    }

    if (rpcTarget) {
      return toOption(rpcTarget)
    }

    return undefined
  }

  /**
   * Returns the account's native SOL balance.
   *
   * @returns {Promise<bigint>} The sol balance (in lamports).
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   */
  async getBalance () {
    if (!this._rpc) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to retrieve balances.')
    }

    const addr = await this.getAddress()
    const balance = await this._rpc.getBalance(address(addr), { commitment: this._commitment }).send()

    return balance.value
  }

  /**
   * Returns the account balance for a specific token, held under either the SPL Token
   * Program or the Token Extensions Program (Token-2022).
   *
   * @param {string} tokenAddress - The smart contract address of the token.
   * @returns {Promise<bigint>} The token balance (in base unit).
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   */
  async getTokenBalance (tokenAddress) {
    if (!this._rpc) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to retrieve token balances.')
    }

    const addr = await this.getAddress()
    const ownerAddress = address(addr)
    const mint = address(tokenAddress)

    const tokenProgram = await this._resolveTokenProgram(tokenAddress)

    const [ata] = await findAssociatedTokenPda({
      mint,
      owner: ownerAddress,
      tokenProgram
    })
    const accountInfo = await this._rpc
      .getAccountInfo(ata, { commitment: this._commitment, encoding: 'base64' })
      .send()

    if (!accountInfo.value) {
      // ATA doesn't exist, user has never received this token
      return 0n
    }

    const tokenAccountBalance = await this._rpc.getTokenAccountBalance(ata, { commitment: this._commitment }).send()

    return BigInt(tokenAccountBalance.value.amount)
  }

  /**
   * Returns the account balances for a list of tokens, held under either the SPL Token
   * Program or the Token Extensions Program (Token-2022). The two may be mixed freely
   * within one call.
   *
   * @param {string[]} tokenAddresses - The smart contract addresses of the tokens.
   * @returns {Promise<Record<string, bigint>>} A mapping of token addresses to their balances (in base units).
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   */
  async getTokenBalances (tokenAddresses) {
    if (!this._rpc) {
      throw new ProviderRequiredError(
        'The wallet must be connected to a provider to retrieve token balances.'
      )
    }

    if (!tokenAddresses || tokenAddresses.length === 0) {
      return {}
    }

    const addr = await this.getAddress()
    const ownerAddress = address(addr)

    const uniqueTokenAddresses = [...new Set(tokenAddresses)]
    const tokenPrograms = await this._resolveTokenPrograms(uniqueTokenAddresses)

    const atas = await Promise.all(
      uniqueTokenAddresses.map(tokenAddress =>
        findAssociatedTokenPda({
          mint: address(tokenAddress),
          owner: ownerAddress,
          tokenProgram: tokenPrograms[tokenAddress]
        }).then(([ata]) => ata)
      )
    )

    const balances = {}
    const base64Encoder = getBase64Encoder()

    for (let offset = 0; offset < atas.length; offset += MAX_ACCOUNTS_PER_REQUEST) {
      const batchAtas = atas.slice(offset, offset + MAX_ACCOUNTS_PER_REQUEST)
      const batchTokenAddresses = uniqueTokenAddresses.slice(offset, offset + MAX_ACCOUNTS_PER_REQUEST)

      const { value: accounts } = await this._rpc
        .getMultipleAccounts(batchAtas, {
          commitment: this._commitment,
          encoding: 'base64'
        })
        .send()

      for (let i = 0; i < batchTokenAddresses.length; i++) {
        const tokenAddress = batchTokenAddresses[i]
        const account = accounts[i]

        if (!account) {
          balances[tokenAddress] = 0n
          continue
        }

        const dataBase64 = account.data[0]
        const bytes = base64Encoder.encode(dataBase64)

        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength
        )
        balances[tokenAddress] = view.getBigUint64(TOKEN_ACCOUNT_AMOUNT_OFFSET, true)
      }
    }

    return balances
  }

  /**
   * Quotes the costs of a send transaction operation.
   *
   * @param {SolanaTransaction} tx - The transaction: a native transfer object, a transaction
   *   message, or a base64-encoded serialized transaction.
   * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   */
  async quoteSendTransaction (tx) {
    if (!this._rpc) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to quote transactions.')
    }

    if (typeof tx === 'string') {
      const { messageBytes } = this._decodeSerializedTransaction(tx)
      const base64EncodedMessage = getBase64Decoder().decode(messageBytes)

      const fee = await this._getFeeForBase64Message(base64EncodedMessage)

      return { fee }
    }

    const addr = await this.getAddress()

    let transactionMessage = tx

    if (tx.to !== undefined && tx.value !== undefined) {
      transactionMessage = await this._buildNativeTransferTransactionMessage(tx.to, tx.value)
    }

    if (Array.isArray(transactionMessage.instructions)) {
      transactionMessage = await this._ensureLifetime(transactionMessage)
      await this._assertFeePayer(transactionMessage)
      transactionMessage = setTransactionMessageFeePayer(address(addr), transactionMessage)
    }
    const fee = await this._getTransactionFee(transactionMessage)
    return { fee }
  }

  /**
   * Quotes the costs of a transfer operation.
   *
   * @param {TransferOptions} options - The transfer's options.
   * @param {SolanaTransferOptions} [solanaOptions] - The transfer's Solana-specific options.
   * @returns {Promise<Omit<TransferResult, 'hash'>>} The transfer's quotes.
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   */
  async quoteTransfer (options, solanaOptions = {}) {
    if (!this._rpc) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to quote transfer operations.')
    }

    const { token, recipient, amount } = options
    const transactionMessage = await this._buildSPLTransferTransactionMessage(token, recipient, amount, solanaOptions)

    const fee = await this._getTransactionFee(transactionMessage)

    return { fee }
  }

  /**
   * Retrieves a transaction receipt by its signature
   *
   * @deprecated Use {@link getTransaction} instead, which returns a normalized, finality-based receipt. The raw transaction remains available on its `transaction` property.
   * @param {string} hash - The transaction's hash.
   * @returns {Promise<SolanaTransactionReceipt | null>} — The receipt, or null if the transaction has not been included in a block yet.
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   * @throws {ValueError} If the hash is not a valid signature.
   */
  async getTransactionReceipt (hash) {
    if (!this._rpc) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to fetch transaction receipts.')
    }
    if (!isSignature(hash)) {
      throw new ValueError('Invalid signature.')
    }

    const transaction = await this._rpc
      .getTransaction(hash, {
        commitment: this._commitment,
        maxSupportedTransactionVersion: 0,
        encoding: 'json'
      })
      .send()

    return transaction
  }

  /**
   * Returns a normalized, finality-based receipt for a transaction.
   *
   * @param {string} hash - The transaction's signature.
   * @returns {Promise<TransactionReceipt & SolanaTransactionDetails>} The normalized receipt.
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   * @throws {ValueError} If the hash is not a valid signature.
   * @throws {NoSuchElementError} If no transaction has been found for the given hash.
   */
  async getTransaction (hash) {
    if (!this._rpc) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to fetch transactions.')
    }
    if (!isSignature(hash)) {
      throw new ValueError('Invalid signature.')
    }

    const { value: [status] } = await this._rpc
      .getSignatureStatuses([hash], { searchTransactionHistory: true })
      .send()

    if (!status) {
      throw new NoSuchElementError(`No transaction found for '${hash}'.`)
    }

    const settled = status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized'
    const finality = status.confirmationStatus === 'finalized'
      ? 'final'
      : settled ? 'confirmed' : 'pending'

    const transaction = settled
      ? await this._rpc
        .getTransaction(hash, {
          commitment: this._commitment,
          maxSupportedTransactionVersion: 0,
          encoding: 'json'
        })
        .send()
      : null

    return {
      hash,
      finality,
      success: settled ? status.err === null : undefined,
      block: Number(status.slot),
      fee: transaction?.meta ? BigInt(transaction.meta.fee) : undefined,
      confirmations: status.confirmations == null ? null : Number(status.confirmations),
      transaction
    }
  }

  /**
   * Blocks until a transaction reaches the requested finality target, or times out.
   *
   * Note: Solana RPC does not expose a `dropped` state. An evicted or never-landed
   * signature simply reports no status, which is indistinguishable from a not-yet-seen
   * transaction and is treated as still-pending. A dropped transaction therefore surfaces
   * as a {@link TimeoutError} rather than resolving to a `dropped` receipt.
   *
   * @param {string} hash - The transaction's signature.
   * @param {WaitForTransactionOptions} [options] - The wait options.
   * @returns {Promise<TransactionReceipt & SolanaTransactionDetails>} The terminal receipt for the finality target reached (inspect `success` to tell success from revert).
   * @throws {TimeoutError} If the target is not reached before the timeout.
   */
  async waitForTransaction (hash, options = {}) {
    return await super.waitForTransaction(hash, options)
  }

  /**
   * Resolves the token program owning a mint: either the classic SPL Token Program or
   * the Token Extensions Program (Token-2022).
   *
   * @protected
   * @param {string} mintAddress - The mint's address (base58-encoded public key).
   * @returns {Promise<Address>} The address of the owning token program.
   */
  async _resolveTokenProgram (mintAddress) {
    const { tokenProgram } = await this._fetchMintAccount(mintAddress)

    return tokenProgram
  }

  /**
   * Resolves the token program owning each of the given mints, fetching in as few RPC
   * calls as the `getMultipleAccounts` limit allows.
   *
   * @protected
   * @param {string[]} mintAddresses - The mints' addresses (base58-encoded public keys).
   * @returns {Promise<Record<string, Address>>} A mapping of mint addresses to the addresses of their owning token programs.
   */
  async _resolveTokenPrograms (mintAddresses) {
    const mintAccounts = await this._fetchMintAccounts(mintAddresses)

    const tokenPrograms = {}
    for (const [mintAddress, { tokenProgram }] of Object.entries(mintAccounts)) {
      tokenPrograms[mintAddress] = tokenProgram
    }

    return tokenPrograms
  }

  /**
   * Returns the mint account for the given address, from the cache when it has already
   * been fetched by this instance.
   *
   * @protected
   * @param {string} mintAddress - The mint's address (base58-encoded public key).
   * @returns {Promise<MintAccount>} The mint account.
   */
  async _fetchMintAccount (mintAddress) {
    const mintAccounts = await this._fetchMintAccounts([mintAddress])

    return mintAccounts[mintAddress]
  }

  /**
   * Returns the mint accounts for the given addresses, fetching only those missing from
   * the cache and batching them within the `getMultipleAccounts` limit.
   *
   * @protected
   * @param {string[]} mintAddresses - The mints' addresses (base58-encoded public keys).
   * @returns {Promise<Record<string, MintAccount>>} A mapping of mint addresses to their mint accounts.
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   * @throws {NoSuchElementError} If no account exists at one of the given addresses.
   * @throws {ValueError} If one of the accounts is not a mint owned by a supported token program.
   */
  async _fetchMintAccounts (mintAddresses) {
    if (!this._rpc) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to resolve token programs.')
    }

    const uniqueMintAddresses = [...new Set(mintAddresses)]
    const missingMintAddresses = uniqueMintAddresses.filter(mintAddress => !this._mintAccountCache.has(mintAddress))

    const base64Encoder = getBase64Encoder()

    for (let offset = 0; offset < missingMintAddresses.length; offset += MAX_ACCOUNTS_PER_REQUEST) {
      const batchMintAddresses = missingMintAddresses.slice(offset, offset + MAX_ACCOUNTS_PER_REQUEST)

      const { value: accounts } = await this._rpc
        .getMultipleAccounts(batchMintAddresses.map(mintAddress => address(mintAddress)), {
          commitment: this._commitment,
          encoding: 'base64'
        })
        .send()

      for (let i = 0; i < batchMintAddresses.length; i++) {
        const mintAddress = batchMintAddresses[i]
        const account = accounts[i]

        if (!account) {
          throw new NoSuchElementError(`No mint account found for '${mintAddress}'.`)
        }

        const tokenProgram = account.owner

        if (tokenProgram !== TOKEN_PROGRAM_ADDRESS && tokenProgram !== TOKEN_2022_PROGRAM_ADDRESS) {
          throw new ValueError(`'${mintAddress}' is not owned by a supported token program.`)
        }

        const data = base64Encoder.encode(account.data[0])

        if (!isMintAccountData(tokenProgram, data)) {
          throw new ValueError(`'${mintAddress}' is not a mint account.`)
        }

        this._mintAccountCache.set(mintAddress, { tokenProgram, data })
      }
    }

    const mintAccounts = {}
    for (const mintAddress of uniqueMintAddresses) {
      mintAccounts[mintAddress] = this._mintAccountCache.get(mintAddress)
    }

    return mintAccounts
  }

  /**
   * Asserts that a Token-2022 mint may be transferred at all, by refusing the extensions
   * whose transfers this wallet cannot construct correctly.
   *
   * @protected
   * @param {string} token - The token mint address (base58-encoded public key).
   * @param {ReadonlyUint8Array} mintData - The raw mint account data.
   * @returns {void}
   * @throws {NonTransferableTokenError} If the mint is non-transferable.
   * @throws {TransferHookNotSupportedError} If the mint carries a transfer hook.
   * @throws {ConfidentialTransferNotSupportedError} If the mint is configured for confidential transfers.
   * @throws {FrozenTokenAccountError} If the mint freezes by default the accounts it creates.
   */
  _assertMintIsTransferable (token, mintData) {
    const { extensions } = getMint2022Decoder().decode(mintData)

    if (extensions.__option !== 'Some') {
      return
    }

    for (const extension of extensions.value) {
      const rejection = REJECTED_MINT_EXTENSIONS[extension.__kind]
      const error = rejection && rejection(token, extension)

      if (error) {
        throw error
      }
    }
  }

  /**
   * Asserts that an existing Token-2022 recipient account can receive the transfer this
   * wallet builds.
   *
   * @protected
   * @param {string} recipient - The recipient's wallet address (base58-encoded public key).
   * @param {ReadonlyUint8Array} accountData - The raw data of the recipient's associated token account.
   * @returns {void}
   * @throws {FrozenTokenAccountError} If the recipient's account is frozen.
   * @throws {RequiredMemoNotSupportedError} If the recipient's account requires a memo on incoming transfers.
   */
  _assertRecipientAccepts (recipient, accountData) {
    const { state, extensions } = getToken2022Decoder().decode(accountData)

    if (state === AccountState.Frozen) {
      throw new FrozenTokenAccountError(`The token account of '${recipient}' is frozen.`)
    }

    if (extensions.__option !== 'Some') {
      return
    }

    const memoTransfer = extensions.value.find(extension => extension.__kind === 'MemoTransfer')

    if (memoTransfer?.requireIncomingTransferMemos) {
      throw new RequiredMemoNotSupportedError(`The token account of '${recipient}' requires a memo on incoming transfers.`)
    }
  }

  /**
   * Builds a transaction message for a token transfer, under either the SPL Token Program
   * or the Token Extensions Program (Token-2022). Creates instructions for ATA creation
   * (if needed) and token transfer.
   *
   * @protected
   * @param {string} token - The token mint address (base58-encoded public key).
   * @param {string} recipient - The recipient's wallet address (base58-encoded public key).
   * @param {number | bigint} amount - The amount to transfer in token's base units (must be ≤ 2^64-1).
   * @param {SolanaTransferOptions} [solanaOptions] - The transfer's Solana-specific options.
   * @returns {Promise<TransactionMessage>} The constructed transaction message.
   * @throws {ValueError} If the amount exceeds the representable range, if the memo is not a string, or if the memo makes the transaction exceed the maximum transaction size.
   * @todo Support transfer with memo for tokens that require it.
   */
  async _buildSPLTransferTransactionMessage (token, recipient, amount, solanaOptions = {}) {
    const { memo } = solanaOptions ?? {}

    if (typeof amount === 'bigint' && amount > MAX_U64) {
      throw new ValueError('Amount exceeds u64 maximum value')
    }
    if (typeof amount === 'number' && amount > Number.MAX_SAFE_INTEGER) {
      throw new ValueError('Amount exceeds safe integer range')
    }
    // The memo is encoded as UTF-8, and the encoder stringifies whatever it is given, so a
    // non-string would be written to the chain as its string form rather than rejected.
    if (memo !== undefined && typeof memo !== 'string') {
      throw new ValueError('Memo must be a string')
    }

    const addr = await this.getAddress()
    const ownerPublicKey = address(addr)
    const tokenMint = address(token)
    const recipientPublicKey = address(recipient)

    const { tokenProgram, data: mintData } = await this._fetchMintAccount(token)
    const decimals = mintData[MINT_DECIMALS_OFFSET]
    const instructionsFor = TOKEN_PROGRAM_INSTRUCTIONS[tokenProgram]
    const isToken2022 = tokenProgram === TOKEN_2022_PROGRAM_ADDRESS

    if (isToken2022) {
      this._assertMintIsTransferable(token, mintData)
    }

    const [fromATA] = await findAssociatedTokenPda({
      mint: tokenMint,
      owner: ownerPublicKey,
      tokenProgram
    })

    const [toATA] = await findAssociatedTokenPda({
      mint: tokenMint,
      owner: recipientPublicKey,
      tokenProgram
    })

    const instructions = []

    const recipientATAInfo = await this._rpc
      .getAccountInfo(toATA, {
        commitment: this._commitment,
        encoding: 'base64'
      })
      .send()

    if (recipientATAInfo.value && isToken2022) {
      this._assertRecipientAccepts(recipient, getBase64Encoder().encode(recipientATAInfo.value.data[0]))
    }

    if (!recipientATAInfo.value) {
      const createATAInstruction = instructionsFor.createAssociatedTokenIdempotent({
        ata: toATA,
        mint: tokenMint,
        owner: recipientPublicKey,
        payer: ownerPublicKey,
        tokenProgram
      })
      instructions.push(createATAInstruction)
    }

    // The memo has to be logged before the transfer it refers to, since the memo
    // transfer extension only looks at the instructions preceding the transfer.
    if (memo) {
      instructions.push(getAddMemoInstruction({ memo }))
    }

    // The checked variant makes the program verify the mint's decimals, which is
    // mandatory under Token-2022 and a safeguard under the classic program.
    const transferInstruction = instructionsFor.transferChecked({
      source: fromATA,
      mint: tokenMint,
      destination: toATA,
      authority: ownerPublicKey,
      amount: BigInt(amount),
      decimals
    })

    instructions.push(transferInstruction)

    const { value: latestBlockhash } = await this._rpc.getLatestBlockhash({ commitment: this._commitment }).send()

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(ownerPublicKey, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions(instructions, tx)
    )

    // The memo is the only caller-sized part of the message, so an oversized one is caught here
    // rather than by the provider, which would reject the transaction with an opaque error.
    const size = getTransactionMessageSize(transactionMessage)

    if (size > TRANSACTION_SIZE_LIMIT) {
      throw new ValueError(`The transfer transaction is ${size} bytes, over the ${TRANSACTION_SIZE_LIMIT} bytes limit. Shorten the memo.`)
    }

    return transactionMessage
  }

  /**
   * Builds a transaction message for native SOL transfer.
   * Creates a transfer instruction for sending SOL.
   *
   * @protected
   * @param {string} to - The recipient's address.
   * @param {number | bigint} value - The amount of SOL to send (in lamports).
   * @returns {Promise<TransactionMessage>} The constructed transaction message.
   */
  async _buildNativeTransferTransactionMessage (to, value) {
    const addr = await this.getAddress()
    const fromPublicKey = address(addr)
    const toPublicKey = address(to)

    const transferInstruction = getTransferSolInstruction({
      source: { address: fromPublicKey },
      destination: toPublicKey,
      amount: BigInt(value)
    })

    const { value: latestBlockhash } = await this._rpc.getLatestBlockhash({ commitment: this._commitment }).send()

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(fromPublicKey, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstruction(transferInstruction, tx)
    )

    return transactionMessage
  }

  /**
   * Calculates the fee for a given transaction message.
   *
   * @protected
   * @param {TransactionMessage} transactionMessage - The transaction message to calculate fee for.
   * @returns {Promise<bigint>} The calculated transaction fee in lamports.
   */
  async _getTransactionFee (transactionMessage) {
    const compiledTransactionMessageEncoder = getCompiledTransactionMessageEncoder()
    const base64Decoder = getBase64Decoder()

    const base64EncodedMessage = pipe(
      transactionMessage,
      compileTransactionMessage,
      compiledTransactionMessageEncoder.encode,
      base64Decoder.decode
    )

    return await this._getFeeForBase64Message(base64EncodedMessage)
  }

  /**
   * Queries the RPC for the fee of a base64-encoded, compiled transaction message.
   *
   * @protected
   * @param {string} base64EncodedMessage - The base64-encoded compiled transaction message.
   * @returns {Promise<bigint>} The calculated transaction fee in lamports.
   * @throws {ValueError} If the provider cannot compute a fee for the message, e.g. because its blockhash has expired.
   */
  async _getFeeForBase64Message (base64EncodedMessage) {
    const fee = await this._rpc
      .getFeeForMessage(base64EncodedMessage, {
        commitment: this._commitment
      })
      .send()
    if (!fee.value) {
      throw new ValueError('Failed to calculate transaction fee')
    }
    return BigInt(fee.value)
  }

  /**
   * Decodes a base64-encoded serialized transaction.
   *
   * @protected
   * @param {string} serializedTransaction - The base64-encoded serialized transaction.
   * @returns {Transaction} The decoded transaction.
   */
  _decodeSerializedTransaction (serializedTransaction) {
    const bytes = getBase64Encoder().encode(serializedTransaction)

    return getTransactionDecoder().decode(bytes)
  }

  /**
   * Verifies a message's signature.
   *
   * @param {string} message - The original message.
   * @param {string} signature - The signature to verify.
   * @returns {Promise<boolean>} True if the signature is valid.
   */
  async verify (message, signature) {
    const messageBytes = Buffer.from(message, 'utf8')
    const signatureBytes = Buffer.from(signature, 'hex')

    const addr = await this.getAddress()
    const publicKey = await getPublicKeyFromAddress(address(addr))

    const isValid = await verifySignature(publicKey, signatureBytes, messageBytes)

    return isValid
  }

  /**
   * Ensures the transaction has either a blockhash lifetime or a durable nonce lifetime.
   *
   * @protected
   * @param {SolanaTransaction} tx - The transaction.
   * @returns {Promise<SolanaTransaction>} The transaction with lifetime.
   */
  async _ensureLifetime (tx) {
    if (
      !isTransactionMessageWithBlockhashLifetime(tx) &&
      !isTransactionMessageWithDurableNonceLifetime(tx)
    ) {
      const { value: latestBlockhash } = await this._rpc.getLatestBlockhash({ commitment: this._commitment }).send()
      return setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
    }

    return tx
  }

  /**
   * Asserts that any explicit transaction fee payer matches this wallet address.
   *
   * @protected
   * @param {SolanaTransaction} tx - The transaction.
   * @returns {Promise<void>} Resolves when the transaction has no explicit fee payer or it matches this wallet address.
   * @throws {ValueError} If the transaction fee payer does not match this wallet address.
   */
  async _assertFeePayer (tx) {
    if (tx.feePayer) {
      const ownerAddress = await this.getAddress()
      const feePayerAddress = typeof tx.feePayer === 'string' ? tx.feePayer : tx.feePayer.address
      if (feePayerAddress !== ownerAddress) {
        throw new ValueError(`Transaction fee payer (${feePayerAddress}) does not match wallet address (${ownerAddress})`)
      }
    }
  }
}
