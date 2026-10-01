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

import { address } from '@solana/addresses'
import {
  getOffchainMessageEncoder,
  offchainMessageApplicationDomain,
  offchainMessageContentRestrictedAsciiOf1232BytesMax
} from '@solana/offchain-messages'
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system'

/** @typedef {import('@solana/offchain-messages').OffchainMessage} OffchainMessage */

/**
 * Encodes a message as the content a signer signs for an off-chain message v0 (restricted ASCII,
 * at most 1232 bytes, system program application domain), as Ledger devices do.
 *
 * @param {string} addr - The signer's address.
 * @param {string} message - The message.
 * @returns {Uint8Array} The signing content.
 */
export function constructOffchainMessageV0Content (addr, message) {
  /** @type {OffchainMessage} */
  const offchainMessage = {
    version: 0,
    requiredSignatories: [{ address: address(addr) }],
    applicationDomain: offchainMessageApplicationDomain(SYSTEM_PROGRAM_ADDRESS),
    content: offchainMessageContentRestrictedAsciiOf1232BytesMax(message)
  }

  return Uint8Array.from(getOffchainMessageEncoder().encode(offchainMessage))
}
