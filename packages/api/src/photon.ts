/**
 * Build entry shim for the `@librechat/api/photon` subpath export.
 * The Photon SDK (`@spectrum-ts/*`, ESM-only, gRPC) is loaded only by the
 * connector runner that requires this entry; the main bundle never pulls it in.
 */
export * from './channels/photon/client';
