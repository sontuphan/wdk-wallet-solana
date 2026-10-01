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
import { of } from 'rxjs'

const DEVICE_ADDRESS = '3uXqWpwgqKVdiHAwF6Vmu4G4vdQzpR66xjPkz1G7zMKE'

const deviceSigner = {
  getAddress: jest.fn()
}

jest.unstable_mockModule('@ledgerhq/device-management-kit', () => ({
  DeviceActionStatus: { Completed: 'completed', Error: 'error', Stopped: 'stopped' },
  DeviceStatus: { LOCKED: 'LOCKED', BUSY: 'BUSY', NOT_CONNECTED: 'NOT CONNECTED', CONNECTED: 'CONNECTED' },
  DeviceManagementKitBuilder: class {
    addTransport () { return this }
    build () { return {} }
  }
}))

jest.unstable_mockModule('@ledgerhq/device-transport-kit-web-hid', () => ({
  webHidTransportFactory: {}
}))

jest.unstable_mockModule('@ledgerhq/device-signer-kit-solana', () => ({
  SignerSolanaBuilder: class {
    build () { return deviceSigner }
  }
}))

const { default: LedgerSignerSolana } = await import('../../src/signers/ledger-signer-solana.js')

describe('LedgerSignerSolana', () => {
  let dmk

  beforeEach(() => {
    dmk = {
      startDiscovering: () => of({ id: 'device' }),
      connect: async () => 'session',
      getDeviceSessionState: () => of({ status: 'CONNECTED' }),
      disconnect: async () => {}
    }

    deviceSigner.getAddress.mockReset()
    deviceSigner.getAddress.mockReturnValue({ observable: of({ status: 'completed', output: DEVICE_ADDRESS }) })
  })

  describe('path', () => {
    it('should default to the coin-type node', () => {
      const signer = new LedgerSignerSolana(undefined, { dmk })

      expect(signer.path).toBe("m/44'/501'")
    })

    it('should keep an absolute path as given', () => {
      const signer = new LedgerSignerSolana("m/44'/501'/0'/0'", { dmk })

      expect(signer.path).toBe("m/44'/501'/0'/0'")
    })

    it('should throw if the path is not absolute', () => {
      expect(() => new LedgerSignerSolana("0'/0'", { dmk }))
        .toThrow('The derivation path must be absolute')
    })

    it('should throw if the path is not fully hardened', () => {
      expect(() => new LedgerSignerSolana("m/44'/501'/0'/0", { dmk }))
        .toThrow('In Solana, every child path in a derivation path must be hardened.')
    })
  })

  describe('derive', () => {
    it('should derive relative to the signer path', async () => {
      const signer = new LedgerSignerSolana(undefined, { dmk })

      const child = await signer.derive("0'/0'")

      expect(child.path).toBe("m/44'/501'/0'/0'")
    })

    it('should not prefix the path again when deriving from a child', async () => {
      const signer = new LedgerSignerSolana(undefined, { dmk })

      const grandchild = await (await signer.derive("0'")).derive("0'")

      expect(grandchild.path).toBe("m/44'/501'/0'/0'")
    })

    it('should throw if the relative path is not fully hardened', async () => {
      const signer = new LedgerSignerSolana(undefined, { dmk })

      await expect(signer.derive("0'/0"))
        .rejects.toThrow('In Solana, every child path in a derivation path must be hardened.')
    })
  })

  describe('getAddress', () => {
    it('should request the address for the path without the leading "m/"', async () => {
      const signer = await new LedgerSignerSolana(undefined, { dmk }).derive("0'/0'")

      const address = await signer.getAddress()

      expect(address).toBe(DEVICE_ADDRESS)
      expect(deviceSigner.getAddress).toHaveBeenCalledWith("44'/501'/0'/0'")
    })
  })
})
