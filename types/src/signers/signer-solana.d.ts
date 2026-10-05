/**
 * Assert every child path in the derivation path is hardened.
 * @param {string} path The derivation path.
 * @param {boolean} [absolute] If true, the path must also be absolute ("m" or "m/...").
 * @throws {ValueError} If the path is required to be absolute and is not, or if any child path is not hardened.
 */
export function assertFullHardenedPath(path: string, absolute?: boolean): void;
/**
 * Interface for Solana signers, extending the base `ISigner` from `@tetherto/wdk-wallet`.
 *
 * @interface
 */
export class ISignerSolana extends ISigner {
    /**
     * Signs a transaction, keeping any signatures it already carries.
     *
     * @param {Uint8Array} unsignedTx - The wire-encoded transaction.
     * @returns {Promise<Uint8Array>} The wire-encoded transaction with this signer's signature added.
     */
    signTransaction(unsignedTx: Uint8Array): Promise<Uint8Array>;
}
import { ISigner } from "@tetherto/wdk-wallet";
