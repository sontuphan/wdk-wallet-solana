// src/signers/seed-signer-solana.ts
import { NotImplementedError } from "@tetherto/wdk-wallet";
import * as bip39 from "bip39";
import HDKey from "micro-key-producer/slip10.js";
import { verifySignature, signBytes } from "@solana/keys";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners
} from "@solana/signers";
import {
  getBase64EncodedWireTransaction,
  getTransactionDecoder
} from "@solana/transactions";
import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder
} from "@solana/transaction-messages";
import { sodium_memzero } from "sodium-universal";
var BIP_44_SOL_DERIVATION_PATH_PREFIX = "m/44'/501'";
var ISignerSolana = class {
  /**
   * The flag indicates whether the signer is ready to use.
   *
   * @type {boolean}
   */
  get isActive() {
    throw new NotImplementedError("isActive");
  }
  /**
   * The derivation path's index of this account.
   *
   * @type {number}
   */
  get index() {
    throw new NotImplementedError("index");
  }
  /**
   * The derivation path of this account.
   *
   * @type {string}
   */
  get path() {
    throw new NotImplementedError("path");
  }
  /**
   * The signer config.
   *
   * @type {object}
   */
  get config() {
    throw new NotImplementedError("config");
  }
  /**
   * The account address.
   *
   * @type {string}
   */
  get address() {
    throw new NotImplementedError("address");
  }
  /**
   * The account's key pair.
   *
   * Returns the raw key pair bytes in standard Solana format.
   * - privateKey: 32-byte Ed25519 secret key (Uint8Array)
   * - publicKey: 32-byte Ed25519 public key (Uint8Array)
   *
   * @type {KeyPair}
   */
  get keyPair() {
    throw new NotImplementedError("keyPair");
  }
  /**
   * Derive a child account.
   *
   * @param {string} relPath - The relative path.
   * @param {object} config - The config.
   * @returns {SeedSignerSolana} The child instance of SeedSignerSolana.
   */
  derive(relPath, cfg = {}) {
    throw new NotImplementedError("derive(relPath, cfg = {})");
  }
  /**
   * Signs a message.
   *
   * @param {string} message - The message to sign.
   * @returns {Promise<string>} The message's signature.
   */
  async sign(message) {
    throw new NotImplementedError("sign(message)");
  }
  /**
   * Verifies a message's signature.
   *
   * @param {string} message - The original message.
   * @param {string} signature - The signature to verify.
   * @returns {Promise<boolean>} True if the signature is valid.
   */
  async verify(message, signature) {
    throw new NotImplementedError("verify(message, signature)");
  }
  /**
   * Sign a transaction
   *
   * @param {Uint8Array} unsignedTx - The unsigned transaction.
   * @returns {Promise<Uint8Array>} The signed transaction.
   */
  async signTransaction(unsignedTx) {
    throw new NotImplementedError("signTransaction(unsignedTx)");
  }
  /**
   * Disposes the wallet account, erasing the private key from the memory.
   */
  dispose() {
    throw new NotImplementedError("dispose()");
  }
};
var SeedSignerSolana = class _SeedSignerSolana {
  constructor(seed, config = {}, opts = {}) {
    if (opts.root && seed) {
      throw new Error("Provide either a seed or a root, not both.");
    }
    if (!opts.root && !seed) {
      throw new Error("Seed or root is required.");
    }
    if (typeof seed === "string") {
      if (!bip39.validateMnemonic(seed)) {
        throw new Error("The seed phrase is invalid.");
      }
      seed = bip39.mnemonicToSeedSync(seed);
    }
    this._config = config;
    this._isRoot = true;
    this._root = opts.root || (seed ? HDKey.fromMasterSeed(seed).derive(BIP_44_SOL_DERIVATION_PATH_PREFIX) : void 0);
    this._account = void 0;
    this._address = void 0;
    this._path = void 0;
    this._isActive = false;
    if (opts.path) {
      this._initAccount(this._root, opts.path);
      this._path = `${BIP_44_SOL_DERIVATION_PATH_PREFIX}/${opts.path}`;
      this._isRoot = false;
    }
    this._rawPublicKey = void 0;
    this._rawPrivateKey = void 0;
  }
  async _initAccount(root, relPath) {
    const { privateKey } = root.derive(`m/${relPath}`, true);
    const account = await createKeyPairSignerFromPrivateKeyBytes(privateKey);
    this._account = account;
    this._address = this._account.address;
    this._isActive = true;
    const publicKey = await crypto.subtle.exportKey(
      "raw",
      account.keyPair.publicKey
    );
    this._rawPublicKey = new Uint8Array(publicKey);
    this._rawPrivateKey = new Uint8Array(privateKey);
    sodium_memzero(privateKey);
  }
  get isActive() {
    return this._isActive;
  }
  get isRoot() {
    return this._isRoot;
  }
  get index() {
    const segments = this.path.split("/");
    return +segments[3].replace("'", "");
  }
  get path() {
    return this._path;
  }
  get address() {
    return this._address;
  }
  get keyPair() {
    return {
      privateKey: this._rawPrivateKey,
      publicKey: this._rawPublicKey
    };
  }
  derive(relPath, config = {}) {
    const merged = {
      ...this._config,
      ...Object.fromEntries(
        Object.entries(config || {}).filter(([, v]) => v !== void 0)
      )
    };
    return new _SeedSignerSolana(null, merged, {
      root: this._root,
      path: relPath
    });
  }
  async sign(message) {
    if (!this._account) {
      throw new Error("The wallet account has been disposed.");
    }
    const messageBytes = Buffer.from(message, "utf8");
    const signatureBytes = await signBytes(
      this._account.keyPair.privateKey,
      messageBytes
    );
    const signature = Buffer.from(signatureBytes).toString("hex");
    return signature;
  }
  async verify(message, signature) {
    const messageBytes = Buffer.from(message, "utf8");
    const signatureBytes = Buffer.from(signature, "hex");
    const isValid = await verifySignature(
      this._account.keyPair.publicKey,
      signatureBytes,
      messageBytes
    );
    return isValid;
  }
  async signTransaction(unsignedTx) {
    if (!this._account) {
      throw new Error(
        "Cannot sign transactions from a root signer. Derive a child first."
      );
    }
    const tx = getTransactionDecoder().decode(unsignedTx);
    const compiledTransactionMessage = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    const readonlyTransactionMessage = decompileTransactionMessage(
      compiledTransactionMessage
    );
    const transactionMessage = setTransactionMessageFeePayerSigner(
      this._account,
      readonlyTransactionMessage
    );
    const signedTransaction = await signTransactionMessageWithSigners(
      transactionMessage
    );
    return Buffer.from(
      getBase64EncodedWireTransaction(signedTransaction),
      "base64"
    );
  }
  dispose() {
    sodium_memzero(this._rawPrivateKey);
    this._root = void 0;
    this._account = void 0;
    this._address = void 0;
    this._path = void 0;
    this._isActive = false;
  }
};
export {
  ISignerSolana,
  SeedSignerSolana as default
};
//# sourceMappingURL=seed-signer-solana.js.map