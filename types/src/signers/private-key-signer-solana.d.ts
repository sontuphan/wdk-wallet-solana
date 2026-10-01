/**
 * Signer backed by a single raw Ed25519 private key (non-HD).
 *
 * Does not support HD derivation. Signs messages and transactions directly with the key.
 *
 * @implements {ISignerSolana}
 */
export default class PrivateKeySignerSolana implements ISignerSolana {
    /**
     * Creates a new private key signer.
     *
     * The supplied key is copied: the signer keeps its own internal copy alive until {@link dispose}
     * zeroes it, and never wipes the supplied key, whose disposal remains the caller's responsibility.
     *
     * @param {string | Uint8Array} privateKey - The raw Ed25519 private key (hex string or 32 bytes).
     * @throws {ValueError} If the private key is not 32 bytes.
     */
    constructor(privateKey: string | Uint8Array);
    /**
     * Raw Ed25519 private key bytes (32 bytes), owned by the signer.
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
     * The solana keypair, created on first use.
     *
     * @private
     * @type {KeyPairSigner | undefined}
     */
    private _account;
    /**
     * Whether this signer can derive child signers.
     *
     * @type {false}
     */
    get isDerivable(): false;
    /**
     * The derivation path. Always null for private-key signers.
     *
     * @type {null}
     */
    get path(): null;
    /**
     * The account's key pair.
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
     * Derives a child signer using a relative path.
     *
     * @param {string} path - The relative derivation path.
     * @returns {Promise<never>} The derived signer.
     * @throws {UnsupportedOperationError} If the signer does not support account derivation.
     */
    derive(path: string): Promise<never>;
    getAddress(): Promise<string>;
    sign(message: string): Promise<string>;
    signTransaction(unsignedTx: Uint8Array): Promise<Uint8Array>;
    /**
     * Disposes the signer, securely erasing its internal copy of the private key from memory.
     */
    dispose(): void;
}
export type ISignerSolana = import("./signer-solana.js").ISignerSolana;
export type KeyPair = import("@tetherto/wdk-wallet").KeyPair;
export type KeyPairSigner = import("@solana/signers").KeyPairSigner;
