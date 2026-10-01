/**
 * Signer implementation that derives keys from a BIP-39 seed using a SLIP-0010 path.
 *
 * @implements {ISignerSolana}
 */
export default class SeedSignerSolana implements ISignerSolana {
    /**
     * Creates a new seed signer.
     *
     * @param {string | Uint8Array} seed - A [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) mnemonic seed phrase, or a raw BIP-32 master seed (16-64 bytes).
     * @param {string} [path] - An absolute SLIP-0010 path; every segment must be hardened (default: "m/44'/501'").
     * @throws {ValueError} If the seed phrase is invalid, or if the path is not absolute or not fully hardened.
     */
    constructor(seed: string | Uint8Array, path?: string);
    /**
     * Binds the signer to an HD node.
     *
     * @private
     * @param {HDKey} node - The HD node at the signer's path.
     * @param {string} path - The signer's absolute path.
     */
    private _init;
    /** @private */
    private _node;
    /** @private */
    private _path;
    /**
     * The solana keypair, created on first use.
     *
     * @private
     * @type {KeyPairSigner | undefined}
     */
    private _account;
    /**
     * Raw Ed25519 private key bytes (32 bytes).
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    private _rawPrivateKey;
    /**
     * Raw Ed25519 public key bytes (32 bytes).
     *
     * @private
     * @type {Uint8Array}
     */
    private _rawPublicKey;
    /** @private */
    private _address;
    /**
     * Whether this signer can derive child signers. Always true: every seed signer holds an
     * HD node and can derive below its own path.
     *
     * @type {true}
     */
    get isDerivable(): true;
    /**
     * The signer's absolute derivation path.
     *
     * @type {string}
     */
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
    /**
     * Derives a child signer relative to this signer's own path (e.g. calling derive("0'/0'") on
     * a signer at "m/44'/501'" yields a child at "m/44'/501'/0'/0'").
     *
     * @param {string} relPath - The path segment to derive, relative to this signer's own path.
     * @returns {Promise<SeedSignerSolana>} The derived child signer.
     * @throws {ValueError} If the path is not fully hardened.
     */
    derive(relPath: string): Promise<SeedSignerSolana>;
    getAddress(): Promise<string>;
    sign(message: string): Promise<string>;
    signTransaction(unsignedTx: Uint8Array): Promise<Uint8Array>;
    dispose(): void;
}
export type ISignerSolana = import("./signer-solana.js").ISignerSolana;
export type KeyPair = import("@tetherto/wdk-wallet").KeyPair;
export type HDKey = import("micro-key-producer/slip10.js").HDKey;
export type KeyPairSigner = import("@solana/signers").KeyPairSigner;
