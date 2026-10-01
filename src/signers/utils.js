// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import { signBytes } from '@solana/keys'
import { getTransactionDecoder, getTransactionEncoder, partiallySignTransaction } from '@solana/transactions'

/** @typedef {import('@solana/signers').KeyPairSigner} KeyPairSigner */

/**
 * Signs a message with an Ed25519 key pair.
 *
 * @param {KeyPairSigner} account - The key pair signer.
 * @param {string} message - The message to sign.
 * @returns {Promise<string>} The message's signature, as a hex string.
 */
export async function signMessage (account, message) {
  const signature = await signBytes(account.keyPair.privateKey, Buffer.from(message, 'utf8'))

  return Buffer.from(signature).toString('hex')
}

/**
 * Adds a key pair's signature to a wire-encoded transaction, keeping the signatures it already carries.
 *
 * @param {KeyPairSigner} account - The key pair signer.
 * @param {Uint8Array} unsignedTx - The wire-encoded transaction.
 * @returns {Promise<Uint8Array>} The wire-encoded transaction with the key pair's signature added.
 */
export async function signTransactionBytes (account, unsignedTx) {
  const transaction = getTransactionDecoder().decode(unsignedTx)
  const signedTransaction = await partiallySignTransaction([account.keyPair], transaction)

  return Uint8Array.from(getTransactionEncoder().encode(signedTransaction))
}
