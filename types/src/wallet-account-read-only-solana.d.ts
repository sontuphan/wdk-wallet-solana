/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferOptions} TransferOptions */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */
/** @typedef {import('@solana/transaction-messages').TransactionMessage} TransactionMessage */
/** @typedef {import('@solana/rpc').Rpc} SolanaRpc */
/**
 * @typedef {Object} TransferNativeTransaction
 * @property {string} to - The transaction's recipient address.
 * @property {number | bigint} value - The amount of SOL to send (in lamports).
 *
 * Note: This type is defined to match the interface from @tetherto/wdk-wallet
 * for consistency across different blockchain implementations.
 */
/**
 * @typedef {Object} TransferNativeTransaction
 * @property {string} to - The recipient's Solana address.
 * @property {number | bigint} value - The amount of SOL to send in lamports (1 SOL = 1,000,000,000 lamports).
 *
 * @description
 * Note: This type is defined to match the interface from @tetherto/wdk-wallet.
 * Simplified transaction format for native SOL transfers. This type provides a convenient
 * interface for basic transfers without requiring knowledge of Solana's TransactionMessage structure.
 */
/**
 * @typedef {TransferNativeTransaction | TransactionMessage} SolanaTransaction
 * @description
 * Union type that accepts either:
 * - TransferNativeTransaction: {to, value} object for native SOL transfers
 * - TransactionMessage: Full Solana transaction message with instructions, fee payer, and lifetime
 */
/**
 * @typedef {Object} SolanaWalletConfig
 * @property {string} [rpcUrl] - The provider's rpc url.
 * @property {string} [commitment] - The commitment level ('processed', 'confirmed', or 'finalized').
 * @property {number | bigint} [transferMaxFee] - Maximum allowed fee in lamports for transfer operations.
 */
/**
 * Read-only Solana wallet account implementation.
 *
 * @extends WalletAccountReadOnly
 */
export default class WalletAccountReadOnlySolana extends WalletAccountReadOnly {
    /**
     * Creates a new solana read-only wallet account.
     *
     * @param {string} addr - The account's address.
     * @param {Omit<SolanaWalletConfig, 'transferMaxFee'>} [config] - The configuration object.
     */
    constructor(addr: string, config?: Omit<SolanaWalletConfig, "transferMaxFee">);
    /**
     * The read-only wallet account configuration.
     *
     * @protected
     * @type {Omit<SolanaWalletConfig, 'transferMaxFee'>}
     */
    protected _config: Omit<SolanaWalletConfig, "transferMaxFee">;
    /**
     * Solana RPC client for making HTTP requests to the blockchain.
     *
     * @protected
     * @type {SolanaRpc}
     */
    protected _rpc: SolanaRpc;
    /**
     * The commitment level for querying transaction and account states.
     * Determines the level of finality required before returning results.
     *
     * @protected
     * @type {string}
     */
    protected _commitment: string;
    /**
   * Quotes the costs of a send transaction operation.
   *
   * @param {SolanaTransaction} tx - The transaction.
   * @returns {Promise<{fee: bigint}>} Object containing the estimated transaction fee in lamports.
   */
    quoteSendTransaction(tx: SolanaTransaction): Promise<{
        fee: bigint;
    }>;
    /**
     * Retrieves a transaction receipt by its signature
     *
     * @param {string} hash - The transaction's hash.
     * @returns {Promise<any>} — The receipt, or null if the transaction has not been included in a block yet.
     */
    getTransactionReceipt(hash: string): Promise<any>;
    /**
     * Builds a transaction message for SPL token transfer.
     * Creates instructions for ATA creation (if needed) and token transfer.
     *
     * @private
     * @param {string} token - The SPL token mint address (base58-encoded public key).
     * @param {string} recipient - The recipient's wallet address (base58-encoded public key).
     * @param {number | bigint} amount - The amount to transfer in token's base units (must be ≤ 2^64-1).
     * @returns {Promise<import('@solana/transaction-messages').TransactionMessage>} The constructed transaction message.
     * @todo Support Token-2022 (Token Extensions Program).
     * @todo Support transfer with memo for tokens that require it.
     */
    private _buildSPLTransferTransactionMessage;
    /**
     * Builds a transaction message for native SOL transfer.
     * Creates a transfer instruction for sending SOL.
     *
     * @private
     * @param {string} to - The recipient's address.
     * @param {number | bigint} value - The amount of SOL to send (in lamports).
     * @returns {Promise<import('@solana/transaction-messages').TransactionMessage>} The constructed transaction message.
     */
    private _buildNativeTransferTransactionMessage;
    /**
     * Calculates the fee for a given transaction message.
     * @param {TransactionMessage} transactionMessage - The transaction message to calculate fee for.
     * @returns {Promise<bigint>} The calculated transaction fee in lamports.
     */
    _getTransactionFee(transactionMessage: TransactionMessage): Promise<bigint>;
}
export type TransactionResult = import("@tetherto/wdk-wallet").TransactionResult;
export type TransferOptions = import("@tetherto/wdk-wallet").TransferOptions;
export type TransferResult = import("@tetherto/wdk-wallet").TransferResult;
export type TransactionMessage = import("@solana/transaction-messages").TransactionMessage;
export type SolanaRpc = any;
export type TransferNativeTransaction = {
    /**
     * - The transaction's recipient address.
     */
    to: string;
    /**
     * - The amount of SOL to send (in lamports).
     *
     * Note: This type is defined to match the interface from
     */
    value: number | bigint;
};
export type SolanaTransaction = TransferNativeTransaction | TransactionMessage;
export type SolanaWalletConfig = {
    /**
     * - The provider's rpc url.
     */
    rpcUrl?: string;
    /**
     * - The commitment level ('processed', 'confirmed', or 'finalized').
     */
    commitment?: string;
    /**
     * - Maximum allowed fee in lamports for transfer operations.
     */
    transferMaxFee?: number | bigint;
};
import { WalletAccountReadOnly } from '@tetherto/wdk-wallet';
