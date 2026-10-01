/**
 * @implements {ISignerSolana}
 */
export default class SeedSignerSolana implements ISignerSolana {
    /**
     * @constructor
     * @param {string | Uint8Array | null} seed A [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) mnemonic seed phrase, or a raw BIP-32 master seed (16-64 bytes).
     * @param {SeedSignerSolCfg} [config] The signer configuration.
     * @param {SeedSignerSolOpts} [opts] Optional constructor dependencies.
     * @throws {ValueError} If both or neither of a seed and a root are given, if the seed phrase is invalid, or if the path is not fully hardened.
     */
    constructor(seed: string | Uint8Array | null, config?: SeedSignerSolCfg, opts?: SeedSignerSolOpts);
    /** @private */
    _config: SeedSignerSolCfg;
    /** @private */
    _isRoot: boolean;
    /** @private */
    _root: HDKey;
    /**
     * The solana keypair, created on first use.
     *
     * @private
     * @type {KeyPairSigner | undefined}
     */
    private _account;
    /** @private */
    private _address;
    /** @private */
    _path: string;
    /**
     * Raw Ed25519 public key bytes (32 bytes).
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    _rawPublicKey: Uint8Array | undefined;
    /**
     * Raw Ed25519 private key bytes (32 bytes).
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    _rawPrivateKey: Uint8Array | undefined;
    get config(): SeedSignerSolCfg;
    get isRoot(): boolean;
    get index(): number;
    get path(): string;
    /**
     * The account's key pair.
     *
     * Returns the raw key pair bytes in standard Solana format.
     * - privateKey: 32-byte Ed25519 secret key (Uint8Array), or null once disposed
     * - publicKey: 32-byte Ed25519 public key (Uint8Array)
     *
     * @type {KeyPair}
     */
    get keyPair(): KeyPair;
    /**
     * Creates the {@link KeyPairSigner} from the raw private key on first use.
     *
     * @private
     * @returns {Promise<KeyPairSigner>} The key pair signer.
     */
    private _getAccount;
    derive(relPath: string, config?: {}): SeedSignerSolana;
    getAddress(): Promise<string>;
    sign(message: string): Promise<string>;
    verify(message: string, signature: string): Promise<boolean>;
    signTransaction(unsignedTx: Uint8Array): Promise<Uint8Array>;
    dispose(): void;
}
export type ISignerSolana = import("./signer-solana.js").ISignerSolana;
export type KeyPair = import("@tetherto/wdk-wallet").KeyPair;
export type HDKey = import("micro-key-producer/slip10.js").HDKey;
export type KeyPairSigner = import("@solana/signers").KeyPairSigner;
export type SeedSignerSolOpts = {
    /**
     * The root node that can be provided alternatively to the seed.
     */
    root?: HDKey;
    /**
     * The BIP-44 derivation path (e.g. "0'/0'"). Note that, All child paths must be hardened in Solana.
     */
    path?: string;
};
export type SeedSignerSolCfg = any;
