"use strict";

import { ISignerSolana } from "./signer-solana-interface.js";

import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
} from "@ledgerhq/device-management-kit";
import { webHidTransportFactory } from "@ledgerhq/device-transport-kit-web-hid";
import { SignerSolanaBuilder } from "@ledgerhq/device-signer-kit-solana";
import { filter, firstValueFrom, map } from "rxjs";
import { getBase58Decoder, getBase58Encoder } from "@solana/codecs";
import {
  getOffchainMessageEncoder,
  getOffchainMessageEnvelopeDecoder,
  offchainMessageApplicationDomain,
  offchainMessageContentRestrictedAsciiOf1232BytesMax,
} from "@solana/offchain-messages";
import { verifySignature } from "@solana/keys";
import { address, getPublicKeyFromAddress } from "@solana/addresses";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
} from "@solana/transaction-messages";
import { getTransactionDecoder } from "@solana/transactions";

const BIP_44_SOL_DERIVATION_PATH_PREFIX = "m/44'/501'";

/**
 * @typedef {import("@ledgerhq/device-management-kit").DeviceManagementKit} DeviceManagementKit
 */

/**
 * @typedef {import("@ledgerhq/device-signer-kit-solana/internal/DefaultSignerSolana.js").DefaultSignerSolana} DefaultSignerSolana
 */

/**
 * @typedef {import("@solana/offchain-messages").OffchainMessage} OffchainMessage
 */

/**
 * @typedef {Object} LedgerSignerSolOpts
 * @property {DeviceManagementKit} [dmk] Shared [DMK](https://developers.ledger.com/docs/device-interaction/integration/how_to/dmk).
 */

/**
 * @typedef {Object} LedgerSignerSolCfg
 */

/**
 * @implements {ISignerSolana}
 */
export default class LedgerSignerSol {
  /**
   * @constructor
   * @param {string} path The BIP-44 derivation path (e.g. "0'/0'"). Note that, All child path must be hardened in Solana.
   * @param {LedgerSignerSolCfg} config
   * @param {LedgerSignerSolOpts} opts
   */
  constructor(path, config = {}, opts = {}) {
    if (!path) {
      throw new Error("Path is required.");
    }

    this._config = config;
    /**
     * @type {DefaultSignerSolana | undefined} The solana signer.
     */
    this._account = undefined;
    this._address = undefined;
    this._sessionId = "";
    this._path = `${BIP_44_SOL_DERIVATION_PATH_PREFIX}/${path}`;
    this._isActive = false;

    /**
     * @type {DeviceManagementKit}
     */
    this._dmk =
      opts.dmk ||
      new DeviceManagementKitBuilder()
        .addTransport(webHidTransportFactory)
        .build();
  }

  get isActive() {
    return this._isActive;
  }

  get index() {
    if (!this._path) return undefined;
    return +this._path.replace(/'/g, "").split("/").pop();
  }

  get path() {
    return this._path;
  }

  get config() {
    return this._config;
  }

  get address() {
    if (!this._account) throw new Error("Ledger is not connected yet.");
    return this._address;
  }

  /**
   * Discover and connect the device
   *
   * @private
   */
  async _connect() {
    // Discover & Connect the device
    const device = await firstValueFrom(this._dmk.startDiscovering({}));
    this._sessionId = await this._dmk.connect({
      device,
      sessionRefresherOptions: { isRefresherDisabled: true },
    });

    // Create a hardware signer
    this._account = new SignerSolanaBuilder({
      dmk: this._dmk,
      sessionId: this._sessionId,
    }).build();

    // Get the pubkey
    const { observable } = this._account.getAddress(this._path);
    const address = await firstValueFrom(
      observable.pipe(
        filter((evt) => evt.status === DeviceActionStatus.Completed),
        map((evt) => evt.output),
      ),
    );

    // Active
    this._address = address;
    this._isActive = true;
  }

  /**
   * Derive child signer
   * @param {string} relPath
   * @param {LedgerSignerSolCfg} cfg
   * @returns
   */
  derive(relPath, cfg = {}) {
    /**
     * @type {LedgerSignerSolCfg}
     */
    const mergedCfg = {
      ...this._config,
      ...Object.fromEntries(
        Object.entries(cfg || {}).filter(([, v]) => v !== undefined),
      ),
    };

    /**
     * @type {LedgerSignerSolOpts}
     */
    const mergedOpts = {
      ...this.opts,
      dmk: this._dmk,
    };

    return new LedgerSignerSol(`${path}/${relPath}`, mergedCfg, mergedOpts);
  }

  async getAddress() {
    if (!this._account) await this._connect();
    return this._address;
  }

  async sign(message) {
    if (!this._account) await this._connect();

    const { observable } = this._account.signMessage(this._path, message);
    const { signature: envelopedSignature } = await firstValueFrom(
      observable.pipe(
        filter((evt) => evt.status === DeviceActionStatus.Completed),
        map((evt) => evt.output),
      ),
    );

    const { content: _content, signatures } =
      getOffchainMessageEnvelopeDecoder().decode(
        getBase58Encoder().encode(envelopedSignature),
      );
    const [[_addr, signature]] = Object.entries(signatures);

    return Buffer.from(signature).toString("hex");
  }

  async verify(message, signature) {
    if (!this._address) return false;

    const pubkey = await getPublicKeyFromAddress(address(this._address));

    /**
     * @type {OffchainMessage} Offchain message v0
     */
    const offchainMessage = {
      version: 0,
      requiredSignatories: [{ address: address(this._address) }],
      applicationDomain: offchainMessageApplicationDomain(
        SYSTEM_PROGRAM_ADDRESS,
      ),
      content: offchainMessageContentRestrictedAsciiOf1232BytesMax(message),
    };

    const messageBytes = getOffchainMessageEncoder().encode(offchainMessage);
    const signatureBytes = Buffer.from(signature, "hex");

    const valid = await verifySignature(pubkey, signatureBytes, messageBytes);
    return valid;
  }

  async signTransaction(unsignedTx) {
    if (!this._account) await this._connect();

    const tx = getTransactionDecoder().decode(unsignedTx);
    const compiledTransactionMessage =
      getCompiledTransactionMessageEncoder().encode(tx);

    const { observable } = this._account.signTransaction(
      `${path}/0'/0'`,
      new Uint8Array(compiledTransactionMessage),
    );
    const signature = await firstValueFrom(
      observable.pipe(
        filter((evt) => evt.status === DeviceActionStatus.Completed),
        map((evt) => evt.output),
      ),
    );

    return getTransactionEncoder().encode({
      messageBytes: compiledTransactionMessage,
      signatures: {
        [address(addr)]: getBase58Decoder().decode(signature),
      },
    });
  }

  dispose() {
    if (this._account) this._dmk.disconnect({ sessionId: this._sessionId });

    this._account = undefined;
    this._dmk = undefined;
    this._sessionId = "";
    this._isActive = false;
  }
}
