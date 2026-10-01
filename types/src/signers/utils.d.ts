/**
 * Signs a message with an Ed25519 key pair.
 *
 * @param {KeyPairSigner} account - The key pair signer.
 * @param {string} message - The message to sign.
 * @returns {Promise<string>} The message's signature, as a hex string.
 */
export function signMessage(account: KeyPairSigner, message: string): Promise<string>;
/**
 * Adds a key pair's signature to a wire-encoded transaction, keeping the signatures it already carries.
 *
 * @param {KeyPairSigner} account - The key pair signer.
 * @param {Uint8Array} unsignedTx - The wire-encoded transaction.
 * @returns {Promise<Uint8Array>} The wire-encoded transaction with the key pair's signature added.
 */
export function signTransactionBytes(account: KeyPairSigner, unsignedTx: Uint8Array): Promise<Uint8Array>;
export type KeyPairSigner = import("@solana/signers").KeyPairSigner;
