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
    constructor(addr: string, config?: Omit<SolanaWalletConfig, "transferMaxFee" | "transactionMaxFee">);
    /**
     * The read-only wallet account configuration.
     *
     * @protected
     * @type {Omit<SolanaWalletConfig, 'transferMaxFee' | 'transactionMaxFee'>}
     */
    protected _config: Omit<SolanaWalletConfig, "transferMaxFee" | "transactionMaxFee">;
    /**
     * The commitment level for querying transaction and account states.
     * Determines the level of finality required before returning results.
     *
     * @protected
     * @type {Commitment}
     */
    protected _commitment: Commitment;
    /**
     * A Solana RPC client for HTTP requests.
     *
     * @protected
     * @type {SolanaRpc | undefined}
     */
    protected _rpc: SolanaRpc | undefined;
    /**
     * The cache of mint accounts already fetched by this instance, keyed by mint address.
     * A mint never changes owner, so an entry is kept for the lifetime of the account.
     *
     * @protected
     * @type {Map<string, MintAccount>}
     */
    protected _mintAccountCache: Map<string, MintAccount>;
    /**
     * Returns the account balances for a list of tokens, held under either the SPL Token
     * Program or the Token Extensions Program (Token-2022). The two may be mixed freely
     * within one call.
     *
     * @param {string[]} tokenAddresses - The smart contract addresses of the tokens.
     * @returns {Promise<Record<string, bigint>>} A mapping of token addresses to their balances (in base units).
     * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
     */
    getTokenBalances(tokenAddresses: string[]): Promise<Record<string, bigint>>;
    /**
     * Quotes the costs of a send transaction operation.
     *
     * @param {SolanaTransaction} tx - The transaction: a native transfer object, a transaction
     *   message, or a base64-encoded serialized transaction.
     * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
     * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
     */
    quoteSendTransaction(tx: SolanaTransaction): Promise<Omit<TransactionResult, "hash">>;
    /**
     * Retrieves a transaction receipt by its signature
     *
     * @deprecated Use {@link getTransaction} instead, which returns a normalized, finality-based receipt. The raw transaction remains available on its `transaction` property.
     * @param {string} hash - The transaction's hash.
     * @returns {Promise<SolanaTransactionReceipt | null>} — The receipt, or null if the transaction has not been included in a block yet.
     * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
     * @throws {ValueError} If the hash is not a valid signature.
     */
    getTransactionReceipt(hash: string): Promise<SolanaTransactionReceipt | null>;
    /**
     * Returns a normalized, finality-based receipt for a transaction.
     *
     * @param {string} hash - The transaction's signature.
     * @returns {Promise<TransactionReceipt & SolanaTransactionDetails>} The normalized receipt.
     * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
     * @throws {ValueError} If the hash is not a valid signature.
     * @throws {NoSuchElementError} If no transaction has been found for the given hash.
     */
    getTransaction(hash: string): Promise<TransactionReceipt & SolanaTransactionDetails>;
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
    waitForTransaction(hash: string, options?: WaitForTransactionOptions): Promise<TransactionReceipt & SolanaTransactionDetails>;
    /**
     * Resolves the token program owning a mint: either the classic SPL Token Program or
     * the Token Extensions Program (Token-2022).
     *
     * @protected
     * @param {string} mintAddress - The mint's address (base58-encoded public key).
     * @returns {Promise<Address>} The address of the owning token program.
     */
    protected _resolveTokenProgram(mintAddress: string): Promise<Address>;
    /**
     * Resolves the token program owning each of the given mints, fetching in as few RPC
     * calls as the `getMultipleAccounts` limit allows.
     *
     * @protected
     * @param {string[]} mintAddresses - The mints' addresses (base58-encoded public keys).
     * @returns {Promise<Record<string, Address>>} A mapping of mint addresses to the addresses of their owning token programs.
     */
    protected _resolveTokenPrograms(mintAddresses: string[]): Promise<Record<string, Address>>;
    /**
     * Returns the mint account for the given address, from the cache when it has already
     * been fetched by this instance.
     *
     * @protected
     * @param {string} mintAddress - The mint's address (base58-encoded public key).
     * @returns {Promise<MintAccount>} The mint account.
     */
    protected _fetchMintAccount(mintAddress: string): Promise<MintAccount>;
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
    protected _fetchMintAccounts(mintAddresses: string[]): Promise<Record<string, MintAccount>>;
    /**
     * Builds a transaction message for a token transfer, under either the SPL Token Program
     * or the Token Extensions Program (Token-2022). Creates instructions for ATA creation
     * (if needed) and token transfer.
     *
     * @protected
     * @param {string} token - The token mint address (base58-encoded public key).
     * @param {string} recipient - The recipient's wallet address (base58-encoded public key).
     * @param {number | bigint} amount - The amount to transfer in token's base units (must be ≤ 2^64-1).
     * @returns {Promise<TransactionMessage>} The constructed transaction message.
     * @throws {ValueError} If the amount exceeds the representable range.
     * @todo Support transfer with memo for tokens that require it.
     */
    protected _buildSPLTransferTransactionMessage(token: string, recipient: string, amount: number | bigint): Promise<TransactionMessage>;
    /**
     * Builds a transaction message for native SOL transfer.
     * Creates a transfer instruction for sending SOL.
     *
     * @protected
     * @param {string} to - The recipient's address.
     * @param {number | bigint} value - The amount of SOL to send (in lamports).
     * @returns {Promise<TransactionMessage>} The constructed transaction message.
     */
    protected _buildNativeTransferTransactionMessage(to: string, value: number | bigint): Promise<TransactionMessage>;
    /**
     * Calculates the fee for a given transaction message.
     *
     * @protected
     * @param {TransactionMessage} transactionMessage - The transaction message to calculate fee for.
     * @returns {Promise<bigint>} The calculated transaction fee in lamports.
     */
    protected _getTransactionFee(transactionMessage: TransactionMessage): Promise<bigint>;
    /**
     * Queries the RPC for the fee of a base64-encoded, compiled transaction message.
     *
     * @protected
     * @param {string} base64EncodedMessage - The base64-encoded compiled transaction message.
     * @returns {Promise<bigint>} The calculated transaction fee in lamports.
     * @throws {ValueError} If the provider cannot compute a fee for the message, e.g. because its blockhash has expired.
     */
    protected _getFeeForBase64Message(base64EncodedMessage: string): Promise<bigint>;
    /**
     * Decodes a base64-encoded serialized transaction.
     *
     * @protected
     * @param {string} serializedTransaction - The base64-encoded serialized transaction.
     * @returns {Transaction} The decoded transaction.
     */
    protected _decodeSerializedTransaction(serializedTransaction: string): Transaction;
    /**
     * Ensures the transaction has either a blockhash lifetime or a durable nonce lifetime.
     *
     * @protected
     * @param {SolanaTransaction} tx - The transaction.
     * @returns {Promise<SolanaTransaction>} The transaction with lifetime.
     */
    protected _ensureLifetime(tx: SolanaTransaction): Promise<SolanaTransaction>;
    /**
     * Asserts that any explicit transaction fee payer matches this wallet address.
     *
     * @protected
     * @param {SolanaTransaction} tx - The transaction.
     * @returns {Promise<void>} Resolves when the transaction has no explicit fee payer or it matches this wallet address.
     * @throws {ValueError} If the transaction fee payer does not match this wallet address.
     */
    protected _assertFeePayer(tx: SolanaTransaction): Promise<void>;
}
export type TransactionResult = import("@tetherto/wdk-wallet").TransactionResult;
export type TransferOptions = import("@tetherto/wdk-wallet").TransferOptions;
export type TransferResult = import("@tetherto/wdk-wallet").TransferResult;
export type TransactionReceipt = import("@tetherto/wdk-wallet").TransactionReceipt;
export type WaitForTransactionOptions = import("@tetherto/wdk-wallet").WaitForTransactionOptions;
export type Address = import("@solana/addresses").Address;
export type ReadonlyUint8Array = import("@solana/codecs").ReadonlyUint8Array;
export type TransactionMessage = import("@solana/transaction-messages").TransactionMessage;
export type FullySignedTransaction = import("@solana/transactions").FullySignedTransaction;
export type Transaction = import("@solana/transactions").Transaction;
export type SolanaRpc = ReturnType<typeof import("@solana/rpc").createSolanaRpc>;
export type SolanaTransactionReceipt = ReturnType<import("@solana/rpc-api").SolanaRpcApi["getTransaction"]>;
export type Commitment = import("@solana/rpc-types").Commitment;
/**
 * The Solana-specific fields added to a normalized transaction receipt.
 */
export type SolanaTransactionDetails = {
    /**
     * - The number of confirmations, or null once the transaction is finalized (or when the node no longer reports a count).
     */
    confirmations: number | null;
    /**
     * - The native Solana transaction object, or null while the transaction is pending.
     */
    transaction: SolanaTransactionReceipt | null;
};
export type SimpleSolanaTransaction = {
    /**
     * - The recipient's Solana address.
     */
    to: string;
    /**
     * - The amount of SOL to send in lamports (1 SOL = 1,000,000,000 lamports).
     */
    value: number | bigint;
};
/**
 * A transaction to operate on: a native transfer object, a transaction message, or a
 * base64-encoded serialized transaction (e.g. a swap or bridge payload built by an
 * external API).
 */
export type SolanaTransaction = SimpleSolanaTransaction | TransactionMessage | string;
export type SolanaWalletConfig = {
    /**
     * - The Solana RPC url. It's also possible to provide an array of urls instead. In such case, connection errors will cause the wallet to automatically fallback on the next provider in the list.
     */
    provider?: string | string[];
    /**
     * - Deprecated alias for `provider`. If both are set, `provider` takes precedence.
     */
    rpcUrl?: string | string[];
    /**
     * - The commitment level (default: 'confirmed').
     */
    commitment?: Commitment;
    /**
     * - If set and if 'provider' is a list of urls, the number of additional retry attempts after the initial call fails. Total attempts = `1 + retries`. For example, `retries: 3` with 4 providers will try each provider once before throwing. If `retries` exceeds the number of providers, the failover will loop back and retry already-failed providers in round-robin order (default: 3).
     */
    retries?: number;
    /**
     * - Maximum allowed fee in lamports for transfer operations.
     */
    transferMaxFee?: number | bigint;
    /**
     * - The maximum fee amount for sendTransaction and signTransaction operations.
     */
    transactionMaxFee?: number | bigint;
};
/**
 * A mint account, as fetched from the chain and cached by mint address.
 */
export type MintAccount = {
    /**
     * - The address of the token program owning the mint.
     */
    tokenProgram: Address;
    /**
     * - The raw account data.
     */
    data: ReadonlyUint8Array;
};
import { WalletAccountReadOnly } from '@tetherto/wdk-wallet';
