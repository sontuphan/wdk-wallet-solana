/** @typedef {import('./wallet-account-solana.js').SolanaWalletConfig} SolanaWalletConfig */
export default class WalletManagerSolana {
    /**
     * Creates a new wallet manager for solana blockchains.
     *
     * @param {string|Uint8Array} seed - The wallet's seed, either as a [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase or a Uint8Array.
     * @param {SolanaWalletConfig} [config] - The configuration object.
     */
    constructor(seed: string | Uint8Array, config?: SolanaWalletConfig);
    /**
     * @private
     */
    private _rpc;
    /**
     * @private
     */
    private _rpcUrl;
    /**
     * @private
     */
    private _wsUrl;
    /**
     * @private
     */
    private _accounts;
    /**
     * Returns the wallet account at a specific index (see [BIP-44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)).
     *
     * @example
     * // Returns the account with derivation path m/44'/501'/0'/0/1
     * const account = await wallet.getAccount(1);
     * @param {number} [index] - The index of the account to get (default: 0).
     * @returns {Promise<WalletAccountSolana>} The account.
     */
    getAccount(index?: number): Promise<WalletAccountSolana>;
    /**
     * Returns the wallet account at a specific BIP-44 derivation path.
     *
     * @example
     * // Returns the account with derivation path m/44'/501'/0'/0/1
     * const account = await wallet.getAccountByPath("0'/0/1");
     * @param {string} path - The derivation path (e.g. "0'/0/0").
     * @returns {Promise<WalletAccountSolana>} The account.
     */
    getAccountByPath(path: string): Promise<WalletAccountSolana>;
    /**
     * Returns the current fee rates.
     *
     * @returns {Promise<{ normal: number, fast: number }>} The fee rates (in lamports).
     */
    getFeeRates(): Promise<{
        normal: number;
        fast: number;
    }>;
    /**
   * Disposes the wallet manager, erasing the seed buffer.
   */
    dispose(): void;
    _seed: any;
    _config: any;
}
export type SolanaWalletConfig = import("./wallet-account-solana.js").SolanaWalletConfig;
import WalletAccountSolana from './wallet-account-solana.js';
