/**
 * Encodes a message as the content a signer signs for an off-chain message v0 (restricted ASCII,
 * at most 1232 bytes, system program application domain), as Ledger devices do.
 *
 * @param {string} addr - The signer's address.
 * @param {string} message - The message.
 * @returns {Uint8Array} The signing content.
 */
export function constructOffchainMessageV0Content(addr: string, message: string): Uint8Array;
export type OffchainMessage = import("@solana/offchain-messages").OffchainMessage;
