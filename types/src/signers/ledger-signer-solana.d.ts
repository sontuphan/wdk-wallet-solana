/**
 * @implements {ISignerSolana}
 */
export default class LedgerSignerSolana implements ISignerSolana {
    /**
     * Creates a new Ledger signer.
     *
     * @param {string} [path] - An absolute SLIP-0010 path; every segment must be hardened (default: "m/44'/501'").
     * @param {LedgerSignerSolOpts} [opts] - Optional constructor dependencies.
     * @throws {ValueError} If the path is not absolute or not fully hardened.
     */
    constructor(path?: string, opts?: LedgerSignerSolOpts);
    /**
     * The ledger signer.
     * 
     * @private
     * @type {DefaultSignerSolana | undefined}
     */
    _account: DefaultSignerSolana | undefined;
    /** @private */
    _address: string | undefined;
    /** @private */
    _sessionId: string;
    /** @private */
    _path: string;
    /**
     * @private
     * @type {DeviceManagementKit}
     */
    _dmk: DeviceManagementKit;
    get isDerivable(): boolean;
    /**
     * The ledger does not expose key material.
     *
     * @type {null}
     */
    get keyPair(): null;
    get path(): string;
    /**
     * Discover and connect the device
     *
     * @private
     */
    private _connect;
    /**
     * The signer's path in the form the device expects, without the leading "m/".
     *
     * @private
     * @type {string}
     */
    private get _devicePath();
    /**
     * Derives a child signer relative to this signer's own path (e.g. calling derive("0'/0'") on
     * a signer at "m/44'/501'" yields a child at "m/44'/501'/0'/0'"). The child shares the device connection kit.
     *
     * @param {string} relPath - The path segment to derive, relative to this signer's own path.
     * @returns {Promise<LedgerSignerSolana>} The derived child signer.
     * @throws {ValueError} If the path is not fully hardened.
     */
    derive(relPath: string): Promise<LedgerSignerSolana>;
    getAddress(): Promise<string>;
    sign(message: string): Promise<string>;
    signTransaction(unsignedTx: Uint8Array): Promise<Uint8Array>;
    dispose(): void;
    /**
     * Ensures the device is in a usable state before sending actions.
     * - If the device is locked or busy, fails fast with a friendly error.
     * - If the device is not connected, attempts to reconnect.
     *
     * @private
     * @throws {Error} If the device is locked, busy, or not ready before the timeout expires.
     */
    private _ensureDeviceReady(): Promise<void>;
    /**
     * Consume a DeviceAction observable and resolve on Completed; reject early on Error/Stopped.
     *
     * @private
     * @template TOutput
     * @param {Observable<DeviceActionState<TOutput>>} observable
     * @returns {Promise<TOutput>}
     */
    private _consumeDeviceAction<TOutput>(observable: Observable<DeviceActionState<TOutput>>): Promise<TOutput>;
    /** @private */
    private _disconnect(): Promise<void>;
}
export type ISignerSolana = import("./signer-solana.js").ISignerSolana;
export type DeviceManagementKit = import("@ledgerhq/device-management-kit").DeviceManagementKit;
export type DefaultSignerSolana = import("@ledgerhq/device-signer-kit-solana/internal/DefaultSignerSolana.js").DefaultSignerSolana;
export type LedgerSignerSolOpts = {
    /**
     * Shared [DMK](https://developers.ledger.com/docs/device-interaction/integration/how_to/dmk).
     */
    dmk?: DeviceManagementKit;
};
export type Observable<T> = import("rxjs").Observable<T>;
export type DeviceActionState<TOutput> = import("@ledgerhq/device-management-kit").DeviceActionState<TOutput, unknown, unknown>;
