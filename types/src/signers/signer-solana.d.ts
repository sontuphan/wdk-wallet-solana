/**
 * Assert the full path is hardened.
 * @param {string} path The derivation path.
 * @throws {ValueError} If any child path is not hardened.
 */
export function assertFullHardenedPath(path: string): void;
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
