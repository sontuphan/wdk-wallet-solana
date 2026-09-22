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

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

import { address, getAddressDecoder } from '@solana/addresses'
import {
  compileTransaction,
  getBase64EncodedWireTransaction
} from '@solana/transactions'
import {
  AccountState,
  findAssociatedTokenPda,
  getTokenEncoder,
  TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token'
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022'

import WalletAccountReadOnlySolana from '../src/wallet-account-read-only-solana.js'
import { NoSuchElementError, ProviderRequiredError, ValueError } from '@tetherto/wdk-wallet'
import WalletAccountSolana from '../src/wallet-account-solana.js'

const TEST_ADDRESS = 'HmWPZeFgxZAJQYgwh5ipYwjbVTHtjEHB3dnJ5xcQBHX9'
const TEST_ACCOUNT_ADDRESS = '3uXqWpwgqKVdiHAwF6Vmu4G4vdQzpR66xjPkz1G7zMKE'
const TEST_SEED_PHRASE =
  'test walk nut penalty hip pave soap entry language right filter choice'
const TEST_RPC_URL = 'https://mockurl.com'

/**
 * Creates mock account data of the given size, base64-encoded. When `accountType` is
 * given, it is written at offset 165, where Token-2022 tags an account's type.
 */
function createAccountData (size, accountType) {
  const buffer = Buffer.alloc(size)
  if (accountType !== undefined) {
    buffer.writeUInt8(accountType, 165)
  }
  return buffer.toString('base64')
}

/** Creates a mock mint account owned by the given token program. */
function createMintAccount (tokenProgram = TOKEN_PROGRAM_ADDRESS, { size = 82, accountType, decimals = 0 } = {}) {
  const buffer = Buffer.from(createAccountData(size, accountType), 'base64')
  buffer.writeUInt8(decimals, 44)
  return { data: [buffer.toString('base64'), 'base64'], owner: tokenProgram, lamports: 1461600n }
}

/** Creates a mock token account holding the given amount (offset 64, little-endian u64). */
function createTokenAccount (amount, tokenProgram = TOKEN_PROGRAM_ADDRESS, size = 165) {
  const buffer = Buffer.alloc(size)
  buffer.writeBigUInt64LE(BigInt(amount), 64)
  return { data: [buffer.toString('base64'), 'base64'], owner: tokenProgram, lamports: 2039280n }
}

/** Creates a mock RPC response resolving to the given value. */
function mockSend (value) {
  return { send: jest.fn().mockResolvedValue({ value }) }
}

describe('WalletAccountReadOnlySolana', () => {
  let readOnlyAccount
  let mockRpc

  beforeEach(() => {
    readOnlyAccount = new WalletAccountReadOnlySolana(TEST_ADDRESS, {})

    mockRpc = {
      getBalance: jest.fn(),
      getAccountInfo: jest.fn(),
      getTokenAccountBalance: jest.fn(),
      getLatestBlockhash: jest.fn(),
      getFeeForMessage: jest.fn(),
      getTransaction: jest.fn(),
      getSignatureStatuses: jest.fn(),
      getMultipleAccounts: jest.fn()
    }

    readOnlyAccount._rpc = mockRpc
    readOnlyAccount._commitment = 'confirmed'
  })

  describe('Constructor', () => {
    it('should create instance with valid config', () => {
      const account = new WalletAccountReadOnlySolana(TEST_ADDRESS, {
        provider: TEST_RPC_URL,
        commitment: 'confirmed'
      })

      expect(account).toBeInstanceOf(WalletAccountReadOnlySolana)
      expect(account._rpc).toBeDefined()
      expect(account._commitment).toBe('confirmed')
    })

    it('should create instance without provider', () => {
      const account = new WalletAccountReadOnlySolana(TEST_ADDRESS, {})
      expect(account._rpc).toBeUndefined()
    })

    it('should use default commitment level', () => {
      const account = new WalletAccountReadOnlySolana(TEST_ADDRESS, {
        provider: TEST_RPC_URL
      })
      expect(account._commitment).toBe('confirmed')
    })
  })

  describe('getBalance', () => {
    it('should return SOL balance in lamports', async () => {
      mockRpc.getBalance.mockReturnValue({
        send: jest.fn().mockResolvedValue({ value: 1000000000n })
      })

      const balance = await readOnlyAccount.getBalance()

      expect(balance).toBe(1000000000n)
      expect(mockRpc.getBalance).toHaveBeenCalledTimes(1)
    })

    it('should return zero balance for empty account', async () => {
      mockRpc.getBalance.mockReturnValue({
        send: jest.fn().mockResolvedValue({ value: 0n })
      })

      const balance = await readOnlyAccount.getBalance()

      expect(balance).toBe(0n)
    })

    it('should throw error when not connected to provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySolana(
        TEST_ADDRESS,
        {}
      )

      await expect(disconnectedAccount.getBalance()).rejects.toThrow(
        'The wallet must be connected to a provider to retrieve balances.'
      )
    })

    it('should handle RPC errors gracefully', async () => {
      mockRpc.getBalance.mockReturnValue({
        send: jest.fn().mockRejectedValue(new Error('RPC error'))
      })

      await expect(readOnlyAccount.getBalance()).rejects.toThrow('RPC error')
    })

    it('should pass commitment level to RPC call', async () => {
      mockRpc.getBalance.mockReturnValue({
        send: jest.fn().mockResolvedValue({ value: 1000000000n })
      })

      await readOnlyAccount.getBalance()

      expect(mockRpc.getBalance).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ commitment: 'confirmed' })
      )
    })
  })

  describe('getTokenBalance', () => {
    const MOCK_TOKEN_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
    const MOCK_TOKEN_2022_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

    beforeEach(() => {
      mockRpc.getMultipleAccounts.mockReturnValue(mockSend([createMintAccount()]))
    })

    it('should return token balance when ATA exists (TOKEN_PROGRAM)', async () => {
      mockRpc.getAccountInfo.mockReturnValueOnce(mockSend(createTokenAccount(0)))
      mockRpc.getTokenAccountBalance.mockReturnValue(mockSend({
        amount: '1000000',
        decimals: 6,
        uiAmount: 1.0,
        uiAmountString: '1.0'
      }))

      const balance = await readOnlyAccount.getTokenBalance(MOCK_TOKEN_MINT)

      const [ata] = await findAssociatedTokenPda({
        mint: address(MOCK_TOKEN_MINT),
        owner: address(TEST_ADDRESS),
        tokenProgram: TOKEN_PROGRAM_ADDRESS
      })

      expect(balance).toBe(1000000n)
      expect(mockRpc.getAccountInfo).toHaveBeenCalledTimes(1)
      expect(mockRpc.getAccountInfo).toHaveBeenCalledWith(ata, expect.anything())
      expect(mockRpc.getTokenAccountBalance).toHaveBeenCalledTimes(1)
    })

    it('should read the Token-2022 ATA when the mint belongs to the token extensions program', async () => {
      mockRpc.getMultipleAccounts.mockReturnValue(mockSend([createMintAccount(TOKEN_2022_PROGRAM_ADDRESS, { size: 278, accountType: 1 })]))
      mockRpc.getAccountInfo.mockReturnValueOnce(mockSend(createTokenAccount(0, TOKEN_2022_PROGRAM_ADDRESS)))
      mockRpc.getTokenAccountBalance.mockReturnValue(mockSend({
        amount: '2500000',
        decimals: 6,
        uiAmount: 2.5,
        uiAmountString: '2.5'
      }))

      const balance = await readOnlyAccount.getTokenBalance(MOCK_TOKEN_2022_MINT)

      const [ata] = await findAssociatedTokenPda({
        mint: address(MOCK_TOKEN_2022_MINT),
        owner: address(TEST_ADDRESS),
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS
      })

      expect(balance).toBe(2500000n)
      expect(mockRpc.getAccountInfo).toHaveBeenCalledWith(ata, expect.anything())
      expect(mockRpc.getTokenAccountBalance).toHaveBeenCalledWith(ata, expect.anything())
    })

    it('should return zero when ATA does not exist', async () => {
      mockRpc.getAccountInfo.mockReturnValueOnce(mockSend(null))

      const balance = await readOnlyAccount.getTokenBalance(MOCK_TOKEN_MINT)

      expect(balance).toBe(0n)
      expect(mockRpc.getAccountInfo).toHaveBeenCalledTimes(1)
      expect(mockRpc.getTokenAccountBalance).not.toHaveBeenCalled()
    })

    it('should return zero balance when ATA exists but has no tokens', async () => {
      mockRpc.getAccountInfo.mockReturnValue(mockSend(createTokenAccount(0)))
      mockRpc.getTokenAccountBalance.mockReturnValue(mockSend({
        amount: '0',
        decimals: 6,
        uiAmount: 0,
        uiAmountString: '0'
      }))

      const balance = await readOnlyAccount.getTokenBalance(MOCK_TOKEN_MINT)

      expect(balance).toBe(0n)
    })

    it('should resolve the mint only once across calls', async () => {
      mockRpc.getAccountInfo.mockReturnValue(mockSend(null))

      await readOnlyAccount.getTokenBalance(MOCK_TOKEN_MINT)
      await readOnlyAccount.getTokenBalance(MOCK_TOKEN_MINT)

      expect(mockRpc.getMultipleAccounts).toHaveBeenCalledTimes(1)
      expect(mockRpc.getAccountInfo).toHaveBeenCalledTimes(2)
    })

    it('should throw NoSuchElementError when the mint does not exist', async () => {
      mockRpc.getMultipleAccounts.mockReturnValue(mockSend([null]))

      await expect(readOnlyAccount.getTokenBalance(MOCK_TOKEN_MINT)).rejects.toThrow(NoSuchElementError)
    })

    it('should throw ValueError when the address is not a mint', async () => {
      mockRpc.getMultipleAccounts.mockReturnValue(mockSend([createTokenAccount(0)]))

      await expect(readOnlyAccount.getTokenBalance(MOCK_TOKEN_MINT)).rejects.toThrow(ValueError)
    })

    it('should throw error when not connected to provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySolana(
        TEST_ADDRESS,
        {}
      )

      await expect(
        disconnectedAccount.getTokenBalance(MOCK_TOKEN_MINT)
      ).rejects.toThrow(
        'The wallet must be connected to a provider to retrieve token balances.'
      )
    })

    it('should throw error for invalid token mint address', async () => {
      const invalidMint = 'invalid-mint-address'

      await expect(
        readOnlyAccount.getTokenBalance(invalidMint)
      ).rejects.toThrow()
    })

    it('should throw error when getAccountInfo fails', async () => {
      mockRpc.getAccountInfo.mockReturnValue({
        send: jest
          .fn()
          .mockRejectedValue(
            new Error('RPC error: Failed to fetch account info')
          )
      })

      await expect(
        readOnlyAccount.getTokenBalance(MOCK_TOKEN_MINT)
      ).rejects.toThrow('RPC error: Failed to fetch account info')
    })

    it('should throw error when getTokenAccountBalance fails', async () => {
      mockRpc.getAccountInfo.mockReturnValue(mockSend(createTokenAccount(0)))
      mockRpc.getTokenAccountBalance.mockReturnValue({
        send: jest
          .fn()
          .mockRejectedValue(new Error('Failed to get token balance'))
      })

      await expect(
        readOnlyAccount.getTokenBalance(MOCK_TOKEN_MINT)
      ).rejects.toThrow('Failed to get token balance')
    })

    it('should handle different token mints', async () => {
      const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
      const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

      mockRpc.getAccountInfo.mockReturnValue(mockSend(createTokenAccount(0)))
      mockRpc.getTokenAccountBalance
        .mockReturnValueOnce(mockSend({
          amount: '1000000',
          decimals: 6,
          uiAmount: 1.0,
          uiAmountString: '1.0'
        }))
        .mockReturnValueOnce(mockSend({
          amount: '5000000',
          decimals: 6,
          uiAmount: 5.0,
          uiAmountString: '5.0'
        }))

      const usdtBalance = await readOnlyAccount.getTokenBalance(USDT_MINT)
      const usdcBalance = await readOnlyAccount.getTokenBalance(USDC_MINT)

      const [usdtAta] = await findAssociatedTokenPda({
        mint: address(USDT_MINT),
        owner: address(TEST_ADDRESS),
        tokenProgram: TOKEN_PROGRAM_ADDRESS
      })
      const [usdcAta] = await findAssociatedTokenPda({
        mint: address(USDC_MINT),
        owner: address(TEST_ADDRESS),
        tokenProgram: TOKEN_PROGRAM_ADDRESS
      })

      expect(usdtBalance).toBe(1000000n)
      expect(usdcBalance).toBe(5000000n)
      expect(mockRpc.getAccountInfo).toHaveBeenCalledTimes(2)
      expect(mockRpc.getAccountInfo).toHaveBeenNthCalledWith(
        1,
        usdtAta,
        expect.objectContaining({ commitment: 'confirmed', encoding: 'base64' })
      )
      expect(mockRpc.getAccountInfo).toHaveBeenNthCalledWith(
        2,
        usdcAta,
        expect.objectContaining({ commitment: 'confirmed', encoding: 'base64' })
      )
    })
  })

  describe('getTokenBalances', () => {
    const MOCK_TOKEN_MINT_1 = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
    const MOCK_TOKEN_MINT_2 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

    /** Mocks the mint resolution call, then the ATA call, in that order. */
    function mockMintsThenAtas (mints, atas) {
      mockRpc.getMultipleAccounts
        .mockReturnValueOnce(mockSend(mints))
        .mockReturnValueOnce(mockSend(atas))
    }

    it('should return balances for multiple tokens', async () => {
      mockMintsThenAtas(
        [createMintAccount(), createMintAccount()],
        [createTokenAccount(1000000), createTokenAccount(5000000)]
      )

      const balances = await readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1, MOCK_TOKEN_MINT_2])

      expect(balances[MOCK_TOKEN_MINT_1]).toBe(1000000n)
      expect(balances[MOCK_TOKEN_MINT_2]).toBe(5000000n)
      expect(mockRpc.getMultipleAccounts).toHaveBeenCalledTimes(2)
    })

    it('should return balances for a mix of both token programs in one call', async () => {
      mockMintsThenAtas(
        [createMintAccount(), createMintAccount(TOKEN_2022_PROGRAM_ADDRESS, { size: 278, accountType: 1 })],
        [createTokenAccount(1000000), createTokenAccount(7000000, TOKEN_2022_PROGRAM_ADDRESS, 170)]
      )

      const balances = await readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1, MOCK_TOKEN_MINT_2])

      const [classicAta] = await findAssociatedTokenPda({
        mint: address(MOCK_TOKEN_MINT_1),
        owner: address(TEST_ADDRESS),
        tokenProgram: TOKEN_PROGRAM_ADDRESS
      })
      const [token2022Ata] = await findAssociatedTokenPda({
        mint: address(MOCK_TOKEN_MINT_2),
        owner: address(TEST_ADDRESS),
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS
      })

      expect(balances[MOCK_TOKEN_MINT_1]).toBe(1000000n)
      expect(balances[MOCK_TOKEN_MINT_2]).toBe(7000000n)
      expect(mockRpc.getMultipleAccounts.mock.calls[1][0]).toEqual([classicAta, token2022Ata])
    })

    it('should return 0n for tokens where ATA does not exist', async () => {
      mockMintsThenAtas([createMintAccount(), createMintAccount()], [null, null])

      const balances = await readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1, MOCK_TOKEN_MINT_2])

      expect(balances[MOCK_TOKEN_MINT_1]).toBe(0n)
      expect(balances[MOCK_TOKEN_MINT_2]).toBe(0n)
    })

    it('should handle mix of existing and non-existing ATAs', async () => {
      mockMintsThenAtas(
        [createMintAccount(), createMintAccount()],
        [createTokenAccount(1000000), null]
      )

      const balances = await readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1, MOCK_TOKEN_MINT_2])

      expect(balances[MOCK_TOKEN_MINT_1]).toBe(1000000n)
      expect(balances[MOCK_TOKEN_MINT_2]).toBe(0n)
    })

    it('should deduplicate token addresses', async () => {
      mockMintsThenAtas([createMintAccount()], [createTokenAccount(1000000)])

      const balances = await readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1, MOCK_TOKEN_MINT_1, MOCK_TOKEN_MINT_1])

      expect(Object.keys(balances)).toHaveLength(1)
      expect(balances[MOCK_TOKEN_MINT_1]).toBe(1000000n)
      expect(mockRpc.getMultipleAccounts.mock.calls[0][0]).toHaveLength(1)
      expect(mockRpc.getMultipleAccounts.mock.calls[1][0]).toHaveLength(1)
    })

    it('should handle single token address', async () => {
      mockMintsThenAtas([createMintAccount()], [createTokenAccount(999999)])

      const balances = await readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1])

      expect(balances[MOCK_TOKEN_MINT_1]).toBe(999999n)
      expect(Object.keys(balances)).toHaveLength(1)
    })

    it('should handle zero balance in existing ATA', async () => {
      mockMintsThenAtas([createMintAccount()], [createTokenAccount(0)])

      const balances = await readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1])

      expect(balances[MOCK_TOKEN_MINT_1]).toBe(0n)
    })

    it('should reuse mints already resolved by an earlier call', async () => {
      mockMintsThenAtas([createMintAccount()], [createTokenAccount(1000000)])
      mockRpc.getMultipleAccounts.mockReturnValueOnce(mockSend([createTokenAccount(2000000)]))

      await readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1])
      const balances = await readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1])

      expect(balances[MOCK_TOKEN_MINT_1]).toBe(2000000n)
      expect(mockRpc.getMultipleAccounts).toHaveBeenCalledTimes(3)
    })

    it('should handle empty token addresses array', async () => {
      const balances = await readOnlyAccount.getTokenBalances([])

      expect(balances).toEqual({})
      expect(mockRpc.getMultipleAccounts).not.toHaveBeenCalled()
    })

    it('should throw error when not connected to provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySolana(TEST_ADDRESS, {})

      await expect(disconnectedAccount.getTokenBalances([MOCK_TOKEN_MINT_1])).rejects.toThrow(
        'The wallet must be connected to a provider to retrieve token balances.'
      )
    })

    it('should throw NoSuchElementError when one of the mints does not exist', async () => {
      mockRpc.getMultipleAccounts.mockReturnValueOnce(mockSend([createMintAccount(), null]))

      await expect(readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1, MOCK_TOKEN_MINT_2]))
        .rejects.toThrow(NoSuchElementError)
    })

    it('should handle RPC error from getMultipleAccounts', async () => {
      mockRpc.getMultipleAccounts.mockReturnValue({
        send: jest.fn().mockRejectedValue(new Error('RPC error: Failed to fetch accounts'))
      })

      await expect(readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1])).rejects.toThrow(
        'RPC error: Failed to fetch accounts'
      )
    })

    it('should pass commitment and encoding to getMultipleAccounts', async () => {
      mockMintsThenAtas([createMintAccount()], [null])

      await readOnlyAccount.getTokenBalances([MOCK_TOKEN_MINT_1])

      expect(mockRpc.getMultipleAccounts).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          commitment: 'confirmed',
          encoding: 'base64'
        })
      )
    })

    it('should throw error for invalid token mint address', async () => {
      await expect(readOnlyAccount.getTokenBalances(['invalid-mint'])).rejects.toThrow()
    })
  })

  describe('token program resolution', () => {
    const CLASSIC_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
    const TOKEN_2022_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const UNKNOWN_PROGRAM_ADDRESS = '11111111111111111111111111111111'

    function mockAccounts (accounts) {
      mockRpc.getMultipleAccounts.mockReturnValue(mockSend(accounts))
    }

    it('should resolve a classic SPL mint to the token program', async () => {
      mockAccounts([createMintAccount(TOKEN_PROGRAM_ADDRESS)])

      const tokenProgram = await readOnlyAccount._resolveTokenProgram(CLASSIC_MINT)

      expect(tokenProgram).toBe(TOKEN_PROGRAM_ADDRESS)
    })

    it('should resolve a bare Token-2022 mint to the token extensions program', async () => {
      mockAccounts([createMintAccount(TOKEN_2022_PROGRAM_ADDRESS)])

      const tokenProgram = await readOnlyAccount._resolveTokenProgram(TOKEN_2022_MINT)

      expect(tokenProgram).toBe(TOKEN_2022_PROGRAM_ADDRESS)
    })

    it('should resolve a Token-2022 mint carrying extensions', async () => {
      mockAccounts([createMintAccount(TOKEN_2022_PROGRAM_ADDRESS, { size: 278, accountType: 1 })])

      const tokenProgram = await readOnlyAccount._resolveTokenProgram(TOKEN_2022_MINT)

      expect(tokenProgram).toBe(TOKEN_2022_PROGRAM_ADDRESS)
    })

    it('should resolve several mints across both programs in a single call', async () => {
      mockAccounts([
        createMintAccount(TOKEN_PROGRAM_ADDRESS),
        createMintAccount(TOKEN_2022_PROGRAM_ADDRESS, { size: 278, accountType: 1 })
      ])

      const tokenPrograms = await readOnlyAccount._resolveTokenPrograms([CLASSIC_MINT, TOKEN_2022_MINT])

      expect(tokenPrograms).toEqual({
        [CLASSIC_MINT]: TOKEN_PROGRAM_ADDRESS,
        [TOKEN_2022_MINT]: TOKEN_2022_PROGRAM_ADDRESS
      })
      expect(mockRpc.getMultipleAccounts).toHaveBeenCalledTimes(1)
    })

    it('should request each mint once when the same mint is repeated', async () => {
      mockAccounts([createMintAccount(TOKEN_PROGRAM_ADDRESS)])

      const tokenPrograms = await readOnlyAccount._resolveTokenPrograms([CLASSIC_MINT, CLASSIC_MINT, CLASSIC_MINT])

      expect(tokenPrograms).toEqual({ [CLASSIC_MINT]: TOKEN_PROGRAM_ADDRESS })
      expect(mockRpc.getMultipleAccounts.mock.calls[0][0]).toEqual([address(CLASSIC_MINT)])
    })

    it('should split requests beyond the 100-account RPC limit', async () => {
      const addressDecoder = getAddressDecoder()
      const mints = Array.from({ length: 101 }, (_, i) => {
        const bytes = new Uint8Array(32)
        bytes[0] = i + 1
        return addressDecoder.decode(bytes)
      })

      mockRpc.getMultipleAccounts
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: Array.from({ length: 100 }, () => createMintAccount(TOKEN_PROGRAM_ADDRESS))
          })
        })
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: [createMintAccount(TOKEN_2022_PROGRAM_ADDRESS)]
          })
        })

      const tokenPrograms = await readOnlyAccount._resolveTokenPrograms(mints)

      expect(mockRpc.getMultipleAccounts).toHaveBeenCalledTimes(2)
      expect(mockRpc.getMultipleAccounts.mock.calls[0][0]).toHaveLength(100)
      expect(mockRpc.getMultipleAccounts.mock.calls[1][0]).toHaveLength(1)
      expect(tokenPrograms[mints[0]]).toBe(TOKEN_PROGRAM_ADDRESS)
      expect(tokenPrograms[mints[100]]).toBe(TOKEN_2022_PROGRAM_ADDRESS)
    })

    it('should not issue a second request for an already resolved mint', async () => {
      mockAccounts([createMintAccount(TOKEN_2022_PROGRAM_ADDRESS)])

      await readOnlyAccount._resolveTokenProgram(TOKEN_2022_MINT)
      const tokenProgram = await readOnlyAccount._resolveTokenProgram(TOKEN_2022_MINT)

      expect(tokenProgram).toBe(TOKEN_2022_PROGRAM_ADDRESS)
      expect(mockRpc.getMultipleAccounts).toHaveBeenCalledTimes(1)
    })

    it('should throw NoSuchElementError when the account does not exist', async () => {
      mockAccounts([null])

      await expect(readOnlyAccount._resolveTokenProgram(CLASSIC_MINT)).rejects.toThrow(NoSuchElementError)
    })

    it('should throw ValueError when the account is owned by another program', async () => {
      mockAccounts([createMintAccount(UNKNOWN_PROGRAM_ADDRESS)])

      await expect(readOnlyAccount._resolveTokenProgram(CLASSIC_MINT)).rejects.toThrow(ValueError)
    })

    it('should throw ValueError when the account is a token account, not a mint', async () => {
      mockAccounts([createMintAccount(TOKEN_PROGRAM_ADDRESS, { size: 165 })])

      await expect(readOnlyAccount._resolveTokenProgram(CLASSIC_MINT)).rejects.toThrow(ValueError)
    })

    it('should throw ValueError for a Token-2022 account tagged as a token account', async () => {
      mockAccounts([createMintAccount(TOKEN_2022_PROGRAM_ADDRESS, { size: 278, accountType: 2 })])

      await expect(readOnlyAccount._resolveTokenProgram(TOKEN_2022_MINT)).rejects.toThrow(ValueError)
    })

    it('should throw ProviderRequiredError when not connected to a provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySolana(TEST_ADDRESS, {})

      await expect(disconnectedAccount._resolveTokenProgram(CLASSIC_MINT)).rejects.toThrow(ProviderRequiredError)
    })
  })

  describe('quoteSendTransaction', () => {
    describe('TransferNativeTransaction', () => {
      beforeEach(() => {
        mockRpc.getLatestBlockhash.mockReturnValue({
          send: jest.fn().mockResolvedValue({
            value: {
              blockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T',
              lastValidBlockHeight: 100000n
            }
          })
        })

        mockRpc.getFeeForMessage.mockReturnValue({
          send: jest.fn().mockResolvedValue({ value: 5000n })
        })
      })

      it('should quote fee for native SOL transfer with bigint value', async () => {
        const nativeTx = {
          to: '4r33xEKAD2cNMrC9NyJy8nb4XmruUKebZ6LZZm65PVUZ',
          value: 1000000000n
        }

        const result = await readOnlyAccount.quoteSendTransaction(nativeTx)

        expect(result).toEqual({ fee: 5000n })
        expect(typeof result.fee).toBe('bigint')
        expect(mockRpc.getLatestBlockhash).toHaveBeenCalledTimes(1)
        expect(mockRpc.getFeeForMessage).toHaveBeenCalledTimes(1)
      })

      it('should quote fee for native SOL transfer with number value', async () => {
        const nativeTx = {
          to: '3gx5puA146Y1jb6dV4KS8vQnXtuXSZsAPV89JeaqfFXW',
          value: 1000000000
        }

        const result = await readOnlyAccount.quoteSendTransaction(nativeTx)

        expect(result).toEqual({ fee: 5000n })
      })

      it('should throw error for invalid recipient address', async () => {
        const invalidTx = { to: 'invalid-address', value: 1000 }

        await expect(
          readOnlyAccount.quoteSendTransaction(invalidTx)
        ).rejects.toThrow()
      })

      it('should throw error for negative value', async () => {
        const invalidTx = {
          to: '3gx5puA146Y1jb6dV4KS8vQnXtuXSZsAPV89JeaqfFXW',
          value: -1000
        }

        await expect(
          readOnlyAccount.quoteSendTransaction(invalidTx)
        ).rejects.toThrow()
      })

      it('should handle getLatestBlockhash failure', async () => {
        mockRpc.getLatestBlockhash.mockReturnValue({
          send: jest.fn().mockRejectedValue(new Error('Network error'))
        })

        const nativeTx = {
          to: '3gx5puA146Y1jb6dV4KS8vQnXtuXSZsAPV89JeaqfFXW',
          value: 1000000n
        }

        await expect(
          readOnlyAccount.quoteSendTransaction(nativeTx)
        ).rejects.toThrow('Network error')
      })

      it('should handle getFeeForMessage failure', async () => {
        mockRpc.getFeeForMessage.mockReturnValue({
          send: jest
            .fn()
            .mockRejectedValue(new Error('Failed to calculate fee'))
        })

        const nativeTx = {
          to: '3gx5puA146Y1jb6dV4KS8vQnXtuXSZsAPV89JeaqfFXW',
          value: 1000000n
        }

        await expect(
          readOnlyAccount.quoteSendTransaction(nativeTx)
        ).rejects.toThrow('Failed to calculate fee')
      })

      it('should handle null fee response', async () => {
        mockRpc.getFeeForMessage.mockReturnValue({
          send: jest.fn().mockResolvedValue({ value: null })
        })

        const nativeTx = {
          to: '3gx5puA146Y1jb6dV4KS8vQnXtuXSZsAPV89JeaqfFXW',
          value: 1000000n
        }

        await expect(
          readOnlyAccount.quoteSendTransaction(nativeTx)
        ).rejects.toThrow('Failed to calculate transaction fee')
      })
    })

    describe('SerializedTransaction', () => {
      it('should quote fee for a base64-encoded serialized transaction', async () => {
        const signingAccount = new WalletAccountSolana(
          TEST_SEED_PHRASE,
          "0'/0'/0'",
          {
            provider: TEST_RPC_URL,
            commitment: 'processed'
          }
        )

        signingAccount._rpc = mockRpc

        mockRpc.getLatestBlockhash.mockReturnValue({
          send: jest.fn().mockResolvedValue({
            value: {
              blockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T',
              lastValidBlockHeight: 100000n
            }
          })
        })
        mockRpc.getFeeForMessage.mockReturnValue({
          send: jest.fn().mockResolvedValue({ value: 5000n })
        })

        const transactionMessage = await signingAccount._prepareTransactionMessage({
          to: '4r33xEKAD2cNMrC9NyJy8nb4XmruUKebZ6LZZm65PVUZ',
          value: 1000000000n
        })
        const serialized = getBase64EncodedWireTransaction(
          compileTransaction(transactionMessage)
        )

        const result = await readOnlyAccount.quoteSendTransaction(serialized)

        expect(result).toEqual({ fee: 5000n })
        expect(mockRpc.getFeeForMessage).toHaveBeenCalledTimes(1)
      })
    })

    describe('TransactionMessage', () => {
      beforeEach(() => {
        mockRpc.getLatestBlockhash.mockReturnValue({
          send: jest.fn().mockResolvedValue({
            value: {
              blockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T',
              lastValidBlockHeight: 100000n
            }
          })
        })

        mockRpc.getFeeForMessage.mockReturnValue({
          send: jest.fn().mockResolvedValue({ value: 5000n })
        })
      })

      it('should quote fee for TransactionMessage with instructions', async () => {
        const transactionMessage = {
          version: 0,
          instructions: [
            {
              programAddress: '11111111111111111111111111111111',
              accounts: [],
              data: new Uint8Array([])
            }
          ],
          lifetimeConstraint: {
            blockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T',
            lastValidBlockHeight: 100000n
          }
        }

        const result =
          await readOnlyAccount.quoteSendTransaction(transactionMessage)

        expect(result).toEqual({ fee: 5000n })
        expect(mockRpc.getFeeForMessage).toHaveBeenCalledTimes(1)
      })

      it('should add lifetimeConstraint when missing from TransactionMessage', async () => {
        const transactionMessage = {
          version: 0,
          instructions: [
            {
              programAddress: '11111111111111111111111111111111',
              accounts: [],
              data: new Uint8Array([])
            }
          ]
        }

        const result =
          await readOnlyAccount.quoteSendTransaction(transactionMessage)

        expect(result).toEqual({ fee: 5000n })
        expect(mockRpc.getLatestBlockhash).toHaveBeenCalledTimes(1)
        expect(mockRpc.getLatestBlockhash).toHaveBeenCalledWith(
          expect.objectContaining({ commitment: 'confirmed' })
        )
        expect(mockRpc.getFeeForMessage).toHaveBeenCalledTimes(1)
      })

      it('should verify feePayer matches wallet address', async () => {
        const transactionMessage = {
          version: 0,
          instructions: [
            {
              programAddress: '11111111111111111111111111111111',
              accounts: [],
              data: new Uint8Array([])
            }
          ],
          feePayer: TEST_ADDRESS,
          lifetimeConstraint: {
            blockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T',
            lastValidBlockHeight: 100000n
          }
        }

        const result =
          await readOnlyAccount.quoteSendTransaction(transactionMessage)

        expect(result).toEqual({ fee: 5000n })
      })

      it('should throw error when feePayer does not match wallet address', async () => {
        const differentAddress = '4r33xEKAD2cNMrC9NyJy8nb4XmruUKebZ6LZZm65PVUZ'
        const transactionMessage = {
          version: 0,
          instructions: [
            {
              programAddress: '11111111111111111111111111111111',
              accounts: [],
              data: new Uint8Array([])
            }
          ],
          feePayer: differentAddress,
          lifetimeConstraint: {
            blockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T',
            lastValidBlockHeight: 100000n
          }
        }

        await expect(
          readOnlyAccount.quoteSendTransaction(transactionMessage)
        ).rejects.toThrow(
          `Transaction fee payer (${differentAddress}) does not match wallet address (${TEST_ADDRESS})`
        )

        expect(mockRpc.getFeeForMessage).not.toHaveBeenCalled()
      })

      it('should add feePayer when missing from TransactionMessage', async () => {
        const transactionMessage = {
          version: 0,
          instructions: [
            {
              programAddress: '11111111111111111111111111111111',
              accounts: [],
              data: new Uint8Array([])
            }
          ],
          lifetimeConstraint: {
            blockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T',
            lastValidBlockHeight: 100000n
          }
        }

        const result =
          await readOnlyAccount.quoteSendTransaction(transactionMessage)

        expect(result).toEqual({ fee: 5000n })
        expect(mockRpc.getFeeForMessage).toHaveBeenCalledTimes(1)
      })

      it('should handle RPC error when fetching latest blockhash for TransactionMessage', async () => {
        mockRpc.getLatestBlockhash.mockReturnValue({
          send: jest
            .fn()
            .mockRejectedValue(new Error('Blockhash fetch failed'))
        })

        const transactionMessage = {
          version: 0,
          instructions: [
            {
              programAddress: '11111111111111111111111111111111',
              accounts: [],
              data: new Uint8Array([])
            }
          ]
        }

        await expect(
          readOnlyAccount.quoteSendTransaction(transactionMessage)
        ).rejects.toThrow('Blockhash fetch failed')
      })

      it('should handle RPC error when calculating fee for TransactionMessage', async () => {
        mockRpc.getFeeForMessage.mockReturnValue({
          send: jest
            .fn()
            .mockRejectedValue(new Error('Fee calculation failed'))
        })

        const transactionMessage = {
          version: 0,
          instructions: [
            {
              programAddress: '11111111111111111111111111111111',
              accounts: [],
              data: new Uint8Array([])
            }
          ],
          feePayer: TEST_ADDRESS,
          lifetimeConstraint: {
            blockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T',
            lastValidBlockHeight: 100000n
          }
        }

        await expect(
          readOnlyAccount.quoteSendTransaction(transactionMessage)
        ).rejects.toThrow('Fee calculation failed')
      })

      it('should throw error when getFeeForMessage returns null for TransactionMessage', async () => {
        mockRpc.getFeeForMessage.mockReturnValue({
          send: jest.fn().mockResolvedValue({ value: null })
        })

        const transactionMessage = {
          version: 0,
          instructions: [
            {
              programAddress: '11111111111111111111111111111111',
              accounts: [],
              data: new Uint8Array([])
            }
          ],
          feePayer: TEST_ADDRESS,
          lifetimeConstraint: {
            blockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T',
            lastValidBlockHeight: 100000n
          }
        }

        await expect(
          readOnlyAccount.quoteSendTransaction(transactionMessage)
        ).rejects.toThrow('Failed to calculate transaction fee')
      })
    })

    describe('Error Handling', () => {
      it('should throw error when not connected to provider', async () => {
        const disconnectedAccount = new WalletAccountReadOnlySolana(
          TEST_ADDRESS,
          {}
        )
        const tx = {
          to: '3gx5puA146Y1jb6dV4KS8vQnXtuXSZsAPV89JeaqfFXW',
          value: 1000n
        }

        await expect(
          disconnectedAccount.quoteSendTransaction(tx)
        ).rejects.toThrow(
          'The wallet must be connected to a provider to quote transactions.'
        )
      })
    })
  })

  describe('token transfer construction', () => {
    const CLASSIC_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
    const TOKEN_2022_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const RECIPIENT = '3uXqWpwgqKVdiHAwF6Vmu4G4vdQzpR66xjPkz1G7zMKE'
    const TRANSFER_CHECKED_DISCRIMINATOR = 12

    beforeEach(() => {
      mockRpc.getLatestBlockhash.mockReturnValue(mockSend({
        blockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T',
        lastValidBlockHeight: 100000n
      }))
    })

    it('should build a transferChecked instruction for a classic SPL mint', async () => {
      mockRpc.getMultipleAccounts.mockReturnValue(mockSend([createMintAccount(TOKEN_PROGRAM_ADDRESS, { decimals: 6 })]))
      mockRpc.getAccountInfo.mockReturnValue(mockSend(createTokenAccount(0)))

      const message = await readOnlyAccount._buildSPLTransferTransactionMessage(CLASSIC_MINT, RECIPIENT, 1000000n)

      const [fromAta] = await findAssociatedTokenPda({
        mint: address(CLASSIC_MINT),
        owner: address(TEST_ADDRESS),
        tokenProgram: TOKEN_PROGRAM_ADDRESS
      })
      const [toAta] = await findAssociatedTokenPda({
        mint: address(CLASSIC_MINT),
        owner: address(RECIPIENT),
        tokenProgram: TOKEN_PROGRAM_ADDRESS
      })

      expect(message.instructions).toHaveLength(1)
      const [transfer] = message.instructions
      expect(transfer.programAddress).toBe(TOKEN_PROGRAM_ADDRESS)
      expect(transfer.accounts.map(a => a.address)).toEqual([
        fromAta,
        address(CLASSIC_MINT),
        toAta,
        address(TEST_ADDRESS)
      ])
      expect(transfer.data[0]).toBe(TRANSFER_CHECKED_DISCRIMINATOR)
      expect(transfer.data[transfer.data.length - 1]).toBe(6)
    })

    it('should build the transfer against the token extensions program for a Token-2022 mint', async () => {
      mockRpc.getMultipleAccounts.mockReturnValue(mockSend([
        createMintAccount(TOKEN_2022_PROGRAM_ADDRESS, { size: 278, accountType: 1, decimals: 9 })
      ]))
      mockRpc.getAccountInfo.mockReturnValue(mockSend(createTokenAccount(0, TOKEN_2022_PROGRAM_ADDRESS, 170)))

      const message = await readOnlyAccount._buildSPLTransferTransactionMessage(TOKEN_2022_MINT, RECIPIENT, 5n)

      const [fromAta] = await findAssociatedTokenPda({
        mint: address(TOKEN_2022_MINT),
        owner: address(TEST_ADDRESS),
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS
      })

      expect(message.instructions).toHaveLength(1)
      const [transfer] = message.instructions
      expect(transfer.programAddress).toBe(TOKEN_2022_PROGRAM_ADDRESS)
      expect(transfer.accounts[0].address).toBe(fromAta)
      expect(transfer.data[transfer.data.length - 1]).toBe(9)
    })

    it('should create the recipient ATA under the mint own token program', async () => {
      mockRpc.getMultipleAccounts.mockReturnValue(mockSend([
        createMintAccount(TOKEN_2022_PROGRAM_ADDRESS, { size: 278, accountType: 1, decimals: 9 })
      ]))
      mockRpc.getAccountInfo.mockReturnValue(mockSend(null))

      const message = await readOnlyAccount._buildSPLTransferTransactionMessage(TOKEN_2022_MINT, RECIPIENT, 5n)

      const [toAta] = await findAssociatedTokenPda({
        mint: address(TOKEN_2022_MINT),
        owner: address(RECIPIENT),
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS
      })

      expect(message.instructions).toHaveLength(2)
      const [createAta] = message.instructions
      expect(createAta.accounts[1].address).toBe(toAta)
      expect(createAta.accounts.map(a => a.address)).toContain(TOKEN_2022_PROGRAM_ADDRESS)
    })

    it('should not create the recipient ATA when it already exists', async () => {
      mockRpc.getMultipleAccounts.mockReturnValue(mockSend([createMintAccount(TOKEN_PROGRAM_ADDRESS, { decimals: 6 })]))
      mockRpc.getAccountInfo.mockReturnValue(mockSend(createTokenAccount(0)))

      const message = await readOnlyAccount._buildSPLTransferTransactionMessage(CLASSIC_MINT, RECIPIENT, 1n)

      expect(message.instructions).toHaveLength(1)
    })

    it('should throw ValueError when the amount exceeds the u64 maximum', async () => {
      await expect(
        readOnlyAccount._buildSPLTransferTransactionMessage(CLASSIC_MINT, RECIPIENT, 2n ** 64n)
      ).rejects.toThrow(ValueError)
    })

    it('should throw ValueError when a number amount exceeds the safe integer range', async () => {
      await expect(
        readOnlyAccount._buildSPLTransferTransactionMessage(CLASSIC_MINT, RECIPIENT, Number.MAX_SAFE_INTEGER + 2)
      ).rejects.toThrow(ValueError)
    })
  })

  describe('quoteTransfer', () => {
    const MOCK_TOKEN_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
    const MOCK_RECIPIENT = 'HmWPZeFgxZAJQYgwh5ipYwjbVTHtjEHB3dnJ5xcQBHX9'

    beforeEach(() => {
      mockRpc.getMultipleAccounts.mockReturnValue(mockSend([createMintAccount(TOKEN_PROGRAM_ADDRESS, { decimals: 6 })]))
      mockRpc.getLatestBlockhash.mockReturnValue({
        send: jest.fn().mockResolvedValue({
          value: {
            blockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T',
            lastValidBlockHeight: 100000n
          }
        })
      })
    })

    it('should quote fee when recipient ATA exists', async () => {
      mockRpc.getAccountInfo
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: {
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              lamports: 2039280n,
              data: [Buffer.alloc(165).toString('base64'), 'base64']
            }
          })
        })
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: {
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              lamports: 2039280n,
              data: [Buffer.alloc(165).toString('base64'), 'base64']
            }
          })
        })
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: {
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              lamports: 2039280n,
              data: [Buffer.alloc(82).toString('base64'), 'base64']
            }
          })
        })

      mockRpc.getFeeForMessage.mockReturnValue({
        send: jest.fn().mockResolvedValue({ value: 5000n })
      })

      const result = await readOnlyAccount.quoteTransfer({
        token: MOCK_TOKEN_MINT,
        recipient: MOCK_RECIPIENT,
        amount: 1000000n
      })

      expect(result).toEqual({ fee: 5000n })
    })

    it('should quote fee when recipient ATA does not exist', async () => {
      mockRpc.getAccountInfo
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({ value: null })
        })
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: {
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              lamports: 2039280n,
              data: [Buffer.alloc(165).toString('base64'), 'base64']
            }
          })
        })
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: {
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              lamports: 2039280n,
              data: [Buffer.alloc(82).toString('base64'), 'base64']
            }
          })
        })

      mockRpc.getFeeForMessage.mockReturnValue({
        send: jest.fn().mockResolvedValue({ value: 7000n })
      })

      const result = await readOnlyAccount.quoteTransfer({
        token: MOCK_TOKEN_MINT,
        recipient: MOCK_RECIPIENT,
        amount: 1000000n
      })

      expect(result.fee).toBe(7000n)
    })

    it('should handle number amount', async () => {
      mockRpc.getAccountInfo
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: {
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              lamports: 2039280n,
              data: [Buffer.alloc(165).toString('base64'), 'base64']
            }
          })
        })
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: {
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              lamports: 2039280n,
              data: [Buffer.alloc(165).toString('base64'), 'base64']
            }
          })
        })
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: {
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              lamports: 2039280n,
              data: [Buffer.alloc(82).toString('base64'), 'base64']
            }
          })
        })

      mockRpc.getFeeForMessage.mockReturnValue({
        send: jest.fn().mockResolvedValue({ value: 5000n })
      })

      const result = await readOnlyAccount.quoteTransfer({
        token: MOCK_TOKEN_MINT,
        recipient: MOCK_RECIPIENT,
        amount: 1000000
      })

      expect(result.fee).toBe(5000n)
    })

    it('should throw error when not connected to provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySolana(
        TEST_ADDRESS,
        {}
      )

      await expect(
        disconnectedAccount.quoteTransfer({
          token: MOCK_TOKEN_MINT,
          recipient: MOCK_RECIPIENT,
          amount: 1000000n
        })
      ).rejects.toThrow(
        'The wallet must be connected to a provider to quote transfer operations.'
      )
    })

    it('should throw error when getFeeForMessage returns null', async () => {
      mockRpc.getAccountInfo
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({ value: null })
        })
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: {
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              lamports: 2039280n,
              data: [Buffer.alloc(165).toString('base64'), 'base64']
            }
          })
        })
        .mockReturnValueOnce({
          send: jest.fn().mockResolvedValue({
            value: {
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              lamports: 2039280n,
              data: [Buffer.alloc(82).toString('base64'), 'base64']
            }
          })
        })

      mockRpc.getFeeForMessage.mockReturnValue({
        send: jest.fn().mockResolvedValue({ value: null })
      })

      await expect(
        readOnlyAccount.quoteTransfer({
          token: MOCK_TOKEN_MINT,
          recipient: MOCK_RECIPIENT,
          amount: 1000000n
        })
      ).rejects.toThrow('Failed to calculate transaction fee')
    })
  })

  describe('getTransactionReceipt', () => {
    const MOCK_TX_SIGNATURE =
      '2k3dxVsXko3Vtb7z2W31GHCbZBzRXCAo5YYqbn7bxUCQM1RQb5Xq1XhWndFGhZGpZ5mGARUx5kavWqFVoBGujpWf'

    it('should return transaction receipt', async () => {
      const mockReceipt = {
        slot: 123456n,
        transaction: {
          message: {
            accountKeys: [],
            header: {
              numRequiredSignatures: 1,
              numReadonlySignedAccounts: 0,
              numReadonlyUnsignedAccounts: 1
            },
            instructions: [],
            recentBlockhash: 'HhqkdqemrKDK5Wd4oiCtzfpBWfdGS79YhLtzAck5Nz7T'
          },
          signatures: [MOCK_TX_SIGNATURE]
        },
        meta: {
          err: null,
          fee: 5000n,
          preBalances: [1000000000n],
          postBalances: [999995000n],
          innerInstructions: [],
          logMessages: [],
          preTokenBalances: [],
          postTokenBalances: [],
          rewards: []
        },
        blockTime: 1234567890n
      }

      mockRpc.getTransaction.mockReturnValue({
        send: jest.fn().mockResolvedValue(mockReceipt)
      })

      const receipt =
        await readOnlyAccount.getTransactionReceipt(MOCK_TX_SIGNATURE)

      expect(receipt).toEqual(mockReceipt)
      expect(receipt.slot).toBe(123456n)
      expect(receipt.meta.fee).toBe(5000n)
      expect(receipt.meta.err).toBeNull()

      expect(mockRpc.getTransaction).toHaveBeenCalledTimes(1)
      expect(mockRpc.getTransaction).toHaveBeenCalledWith(
        MOCK_TX_SIGNATURE,
        expect.objectContaining({
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        })
      )
    })

    it('should return null for non-existent transaction', async () => {
      mockRpc.getTransaction.mockReturnValue({
        send: jest.fn().mockResolvedValue(null)
      })

      const receipt =
        await readOnlyAccount.getTransactionReceipt(MOCK_TX_SIGNATURE)

      expect(receipt).toBeNull()
      expect(mockRpc.getTransaction).toHaveBeenCalledTimes(1)
    })

    it('should throw error when not connected to provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySolana(
        TEST_ADDRESS,
        {}
      )

      await expect(
        disconnectedAccount.getTransactionReceipt(MOCK_TX_SIGNATURE)
      ).rejects.toThrow(
        'The wallet must be connected to a provider to fetch transaction receipts.'
      )
    })

    it('should throw error when getTransaction fails', async () => {
      mockRpc.getTransaction.mockReturnValue({
        send: jest
          .fn()
          .mockRejectedValue(
            new Error('RPC error: Failed to fetch transaction')
          )
      })

      await expect(
        readOnlyAccount.getTransactionReceipt(MOCK_TX_SIGNATURE)
      ).rejects.toThrow('RPC error: Failed to fetch transaction')

      expect(mockRpc.getTransaction).toHaveBeenCalledTimes(1)
    })
    it('should throw error for invalid signature format', async () => {
      const invalidSignature = 'invalid-signature'

      await expect(
        readOnlyAccount.getTransactionReceipt(invalidSignature)
      ).rejects.toThrow()
    })
  })

  describe('getTransaction', () => {
    const MOCK_TX_SIGNATURE =
      '2k3dxVsXko3Vtb7z2W31GHCbZBzRXCAo5YYqbn7bxUCQM1RQb5Xq1XhWndFGhZGpZ5mGARUx5kavWqFVoBGujpWf'

    function mockStatus (status) {
      mockRpc.getSignatureStatuses.mockReturnValue({
        send: jest.fn().mockResolvedValue({ value: [status] })
      })
    }

    function mockReceipt (receipt) {
      mockRpc.getTransaction.mockReturnValue({
        send: jest.fn().mockResolvedValue(receipt)
      })
    }

    it('should throw NoSuchElementError when the transaction is not known', async () => {
      mockStatus(null)

      await expect(readOnlyAccount.getTransaction(MOCK_TX_SIGNATURE)).rejects.toThrow(NoSuchElementError)
      expect(mockRpc.getTransaction).not.toHaveBeenCalled()
    })

    it('should report pending for a processed transaction', async () => {
      mockStatus({ slot: 100n, confirmations: 1n, err: null, confirmationStatus: 'processed' })

      const info = await readOnlyAccount.getTransaction(MOCK_TX_SIGNATURE)

      expect(info).toMatchObject({
        hash: MOCK_TX_SIGNATURE,
        finality: 'pending',
        success: undefined,
        block: 100,
        confirmations: 1,
        transaction: null
      })
      expect(info.fee).toBeUndefined()
      expect(mockRpc.getTransaction).not.toHaveBeenCalled()
    })

    it('should report confirmed with success and fee', async () => {
      mockStatus({ slot: 200n, confirmations: 10n, err: null, confirmationStatus: 'confirmed' })
      mockReceipt({ slot: 200n, meta: { err: null, fee: 5000n } })

      const info = await readOnlyAccount.getTransaction(MOCK_TX_SIGNATURE)

      expect(info).toMatchObject({
        finality: 'confirmed',
        success: true,
        block: 200,
        fee: 5000n,
        confirmations: 10
      })
      expect(info.transaction).not.toBeNull()
    })

    it('should report final when finalized (confirmations null)', async () => {
      mockStatus({ slot: 300n, confirmations: null, err: null, confirmationStatus: 'finalized' })
      mockReceipt({ slot: 300n, meta: { err: null, fee: 5000n } })

      const info = await readOnlyAccount.getTransaction(MOCK_TX_SIGNATURE)

      expect(info).toMatchObject({
        finality: 'final',
        success: true,
        confirmations: null
      })
    })

    it('should report success false for a reverted transaction', async () => {
      mockStatus({ slot: 400n, confirmations: null, err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'finalized' })
      mockReceipt({ slot: 400n, meta: { err: { InstructionError: [0, 'Custom'] }, fee: 5000n } })

      const info = await readOnlyAccount.getTransaction(MOCK_TX_SIGNATURE)

      expect(info.finality).toBe('final')
      expect(info.success).toBe(false)
    })

    it('should search transaction history when querying signature statuses', async () => {
      mockStatus({ slot: 200n, confirmations: 10n, err: null, confirmationStatus: 'confirmed' })
      mockReceipt({ slot: 200n, meta: { err: null, fee: 5000n } })

      await readOnlyAccount.getTransaction(MOCK_TX_SIGNATURE)

      expect(mockRpc.getSignatureStatuses).toHaveBeenCalledWith(
        [MOCK_TX_SIGNATURE],
        expect.objectContaining({ searchTransactionHistory: true })
      )
    })

    it('should throw error when not connected to provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySolana(TEST_ADDRESS, {})

      await expect(
        disconnectedAccount.getTransaction(MOCK_TX_SIGNATURE)
      ).rejects.toThrow(
        'The wallet must be connected to a provider to fetch transactions.'
      )
    })

    it('should throw ValueError for invalid signature format', async () => {
      await expect(readOnlyAccount.getTransaction('invalid-signature')).rejects.toThrow(ValueError)
    })
  })

  describe('verify', () => {
    it('should verify signature for same message across multiple verifications', async () => {
      const account = new WalletAccountSolana(
        TEST_SEED_PHRASE,
        "0'/0'/0'",
        {
          provider: TEST_RPC_URL,
          commitment: 'processed'
        }
      )
      const message = 'Persistent message'
      const signature = await account.sign(message)

      const readOnlyAccount = new WalletAccountReadOnlySolana(
        await account.getAddress(),
        {}
      )
      const isValid1 = await readOnlyAccount.verify(message, signature)
      const isValid2 = await readOnlyAccount.verify(message, signature)
      const isValid3 = await readOnlyAccount.verify(message, signature)

      expect(isValid1).toBe(true)
      expect(isValid2).toBe(true)
      expect(isValid3).toBe(true)

      account.dispose()
    })

    it('should reject signature for different message', async () => {
      const account = new WalletAccountSolana(
        TEST_SEED_PHRASE,
        "0'/0'/0'",
        {
          provider: TEST_RPC_URL,
          commitment: 'processed'
        }
      )
      const message1 = 'Message 1'
      const message2 = 'Message 2'
      const signature1 = await account.sign(message1)

      const readOnlyAccount = new WalletAccountReadOnlySolana(
        await account.getAddress(),
        {}
      )
      expect(await readOnlyAccount.verify(message1, signature1)).toBe(true)
      expect(await readOnlyAccount.verify(message2, signature1)).toBe(false)

      account.dispose()
    })

    it('should reject invalid hex signature', async () => {
      const message = 'Test message'
      const invalidSignature = 'not-a-valid-hex-signature'

      const readOnlyAccount = new WalletAccountReadOnlySolana(
        TEST_ACCOUNT_ADDRESS,
        {}
      )
      expect(await readOnlyAccount.verify(message, invalidSignature)).toBe(
        false
      )
    })
  })
})
