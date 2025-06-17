/** @implements {IWalletAccount} */
export default class WalletAccountSolana implements IWalletAccount {
    /**
     * Creates a new solana wallet account.
     *
     * @param {string|Uint8Array} seed - The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase or Uint8Array.
     * @param {string} path - The BIP-44 derivation path (e.g. "0'/0/0").
     * @param {SolanaWalletConfig} [config] - The configuration object.
     */
    static create(seed: string | Uint8Array, path: string, config?: SolanaWalletConfig): Promise<WalletAccountSolana>;
    /**
   * Intialise a new solana wallet account.
   *
   * @param {string|Uint8Array} seed - The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase or Uint8Array.
   * @param {string} path - The BIP-44 derivation path (e.g. "0'/0/0").
   * @param {SolanaWalletConfig} [config] - The configuration object.
   */
    constructor(seed: string | Uint8Array, path: string, config?: SolanaWalletConfig);
    /**
     * @private
     * @type {Uint8Array}
     * @description The seed buffer derived from the BIP-39 seed phrase.
     */
    private _seedBuffer;
    /**
     * @private
     * @type {string}
     * @description The BIP-44 derivation path for this account.
     * @example "m/44'/501'/0'/0/0"
     */
    private _path;
    /**
     * @private
     * @type {SolanaWalletConfig}
     * @description The configuration object for the wallet account.
     */
    private _config;
    /**
     * Initializes the wallet account.
     * @private
     * @returns {Promise<void>}
     */
    private _initialize;
    _secretKeyBuffer: Uint8Array<ArrayBuffer>;
    _privateKeyBuffer: Uint8Array<any>;
    _publicKeyBuffer: Uint8Array<any>;
    _signer: any;
    _keypair: any;
    _rpc: any;
    _connection: any;
    _rpcSubscriptions: any;
    /**
     * The derivation path's index of this account.
     *
     * @type {number}
     */
    get index(): number;
    /**
     * The derivation path of this account.
     *
     * @type {string}
     */
    get path(): string;
    /**
     * The account's key pair.
     *
     * @type {ExtendedKeyPair}
     */
    get keyPair(): ExtendedKeyPair;
    /**
     * Returns the account's address.
     *
     * @returns {Promise<string>} The account's address.
     */
    getAddress(): Promise<string>;
    /**
     * Signs a message.
     *
     * @param {string} message - The message to sign.
     * @returns {Promise<string>} The message's signature.
     */
    sign(message: string): Promise<string>;
    /**
     * Verifies a message's signature.
     *
     * @param {string} message - The original message.
     * @param {string} signature - The signature to verify.
     * @returns {Promise<boolean>} True if the signature is valid.
     */
    verify(message: string, signature: string): Promise<boolean>;
    /**
     * Creates a transaction message for sending SOL or quoting fees.
     * @private
     * @param {Transaction} tx - The transaction details
     * @param {string} version - The transaction message version ('legacy' or 0)
     * @returns {Promise<Object>} The transaction message and instructions
     */
    private _createTransactionMessage;
    /**
     * Sends a transaction with arbitrary data.
     *
     * @param {Transaction} tx - The transaction to send.
     * @returns {Promise<TransactionResult>} The transaction's hash.
     */
    sendTransaction(tx: Transaction): Promise<TransactionResult>;
    /**
     * Quotes a transaction.
     *
     * @param {Transaction} tx - The transaction to quote.
     * @returns {Promise<Omit<TransactionResult,'hash'>>} The transaction's quotes.
     */
    quoteSendTransaction(tx: Transaction): Promise<Omit<TransactionResult, "hash">>;
    /**
     * Returns the account's native token balance.
     *
     * @returns {Promise<number>} The native token balance in lamports.
     */
    getBalance(): Promise<number>;
    /**
     * Returns the account balance for a specific token.
     *
     * @param {string} tokenAddress - The smart contract address of the token.
     * @returns {Promise<number>} The token balance.
     */
    getTokenBalance(tokenAddress: string): Promise<number>;
    /**
     * Creates a transfer transaction.
     * @private
     * @param {TransferOptions} params - The transaction parameters.
     * @returns {Promise<Transaction>} The transfer transaction.
     */
    private _createTransfer;
    /**
     * Quotes a token transfer.
     *
     * @param {TransferOptions} params - The transaction parameters.
     * @returns {Promise<Omit<TransactionResult,'hash'>>} The transaction's quotes.
     */
    quoteTransfer({ recipient, token, amount }: TransferOptions): Promise<Omit<TransactionResult, "hash">>;
    /**
     * Sends a token transaction.
     *
     * @param {TransferOptions} params - The transaction parameters.
     * @returns {Promise<TransactionResult>} The transaction's hash.
     */
    transfer({ recipient, token, amount }: TransferOptions): Promise<TransactionResult>;
    /**
     * Disposes of the wallet account.
     * @returns {void}
     */
    dispose(): void;
}
export type IWalletAccount = any;
export type KeyPair = import("@wdk/wallet").KeyPair;
export type ExtendedKeyPair = KeyPair & {
    secretKey: string;
};
export type Transaction = import("@wdk/wallet").Transaction;
export type SolanaWalletConfig = {
    /**
     * - The rpc url of the provider.
     */
    rpcUrl?: string;
    /**
     * - The ws url of the provider is optional, if not provided, it will be derived from the rpc url.
     * Note: only use this if you want to use a custom ws url.
     */
    wsUrl?: string;
};
export type TransferOptions = import("@wdk/wallet").TransferOptions;
export type TransactionResult = import("@wdk/wallet").TransactionResult;
export type TransferResult = import("@wdk/wallet").TransferResult;
