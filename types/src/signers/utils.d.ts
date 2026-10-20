/**
 * Signs a message with a raw Ed25519 private key.
 *
 * The key is used in place: no `CryptoKey`, PKCS#8 or JWK copy of it is ever created.
 *
 * @param {Uint8Array} privateKey - The raw Ed25519 private key (32 bytes).
 * @param {string} message - The message to sign.
 * @returns {string} The message's signature, as a hex string.
 */
export function signMessage(privateKey: Uint8Array, message: string): string;
/**
 * Adds a raw Ed25519 private key's signature to a wire-encoded transaction, keeping the
 * signatures it already carries.
 *
 * @param {Uint8Array} privateKey - The raw Ed25519 private key (32 bytes).
 * @param {Uint8Array} unsignedTx - The wire-encoded transaction.
 * @returns {Uint8Array} The wire-encoded transaction with the key's signature added.
 * @throws {InvalidSignerError} If the key's address is not one of the transaction's signers.
 */
export function signTransactionBytes(privateKey: Uint8Array, unsignedTx: Uint8Array): Uint8Array;
