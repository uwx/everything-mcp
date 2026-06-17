/**
 * ffi-bindings.ts — Low-level FFI bindings for the Everything SDK.
 *
 * Uses ffi-rs to load the native DLL and exposes typed wrappers around the C API.
 * All functions use the "W" (wide-character / UTF-16LE) variant for Windows compatibility.
 *
 * Auto-detects the current Node.js architecture (x64, ia32, arm64, arm) and loads
 * the matching Everything3_*.dll.  Override via EVERYTHING_DLL_PATH env var.
 */

import { open, close, load, DataType } from 'ffi-rs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { arch as _arch } from 'os';

// ─── Architecture detection ────────────────────────────────────────────────────

/** Map Node.js process.arch to the Everything DLL suffix. */
const ARCH_TO_DLL: Record<string, string> = {
  x64: 'Everything3_x64.dll',
  ia32: 'Everything3_x86.dll',
  arm: 'Everything3_ARM.dll',
  arm64: 'Everything3_ARM64.dll',
};

const ARCH_TO_LIBKEY: Record<string, string> = {
  x64: 'Everything3_x64',
  ia32: 'Everything3_x86',
  arm: 'Everything3_ARM',
  arm64: 'Everything3_ARM64',
};

const detectedArch = _arch();
const dllName = ARCH_TO_DLL[detectedArch];
const libKey = ARCH_TO_LIBKEY[detectedArch];

if (!dllName) {
  throw new Error(
    `Unsupported architecture: ${detectedArch}. ` +
    `Everything SDK provides DLLs for: ${Object.keys(ARCH_TO_DLL).join(', ')}`,
  );
}

// ─── Library handle ────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the Everything SDK DLLs — ships beside this package or can be overridden via env.
const SDK_DIR = process.env.EVERYTHING_SDK_DIR ?? resolve(__dirname, '..', 'everything_sdk3', 'dll');
const DLL_PATH = process.env.EVERYTHING_DLL_PATH ?? resolve(SDK_DIR, dllName);

let _opened = false;

function ensureOpen(): void {
  if (_opened) return;
  open({ library: libKey, path: DLL_PATH });
  _opened = true;
}

export function closeLibrary(): void {
  if (!_opened) return;
  close(libKey);
  _opened = false;
}

/** Returns the detected architecture info for diagnostics. */
export function getArchInfo(): { arch: string; dll: string; dllPath: string; libKey: string } {
  return {
    arch: detectedArch,
    dll: dllName,
    dllPath: DLL_PATH,
    libKey,
  };
}

// ─── Type aliases for readability ──────────────────────────────────────────────

/** Opaque pointer to an Everything client connection. */
type ClientPtr = unknown;
/** Opaque pointer to a search state. */
type SearchStatePtr = unknown;
/** Opaque pointer to a result list. */
type ResultListPtr = unknown;

// ─── Raw FFI call helper ───────────────────────────────────────────────────────

function ffiCall<T>(funcName: string, retType: DataType, paramsType: DataType[], paramsValue: unknown[]): T {
  ensureOpen();
  return load({
    library: libKey,
    funcName,
    retType,
    paramsType,
    paramsValue,
  }) as T;
}

// ─── Connection ────────────────────────────────────────────────────────────────

/** Connect to Everything. Pass null/empty string for the default instance. */
export function Everything3_ConnectW(instanceName: string | null): ClientPtr {
  ensureOpen();
  const ptr = load({
    library: libKey,
    funcName: 'Everything3_ConnectW',
    retType: DataType.External,
    paramsType: [DataType.WString],
    paramsValue: [instanceName ?? ''],
  });
  return ptr;
}

/** Disconnect and free the client. */
export function Everything3_DestroyClient(client: ClientPtr): void {
  ffiCall('Everything3_DestroyClient', DataType.I32, [DataType.External], [client]);
}

// ─── Version / Info ────────────────────────────────────────────────────────────

export function Everything3_GetMajorVersion(client: ClientPtr): number {
  return ffiCall<number>('Everything3_GetMajorVersion', DataType.U32, [DataType.External], [client]);
}

export function Everything3_GetMinorVersion(client: ClientPtr): number {
  return ffiCall<number>('Everything3_GetMinorVersion', DataType.U32, [DataType.External], [client]);
}

export function Everything3_GetRevision(client: ClientPtr): number {
  return ffiCall<number>('Everything3_GetRevision', DataType.U32, [DataType.External], [client]);
}

export function Everything3_GetBuildNumber(client: ClientPtr): number {
  return ffiCall<number>('Everything3_GetBuildNumber', DataType.U32, [DataType.External], [client]);
}

export function Everything3_GetTargetMachine(client: ClientPtr): number {
  return ffiCall<number>('Everything3_GetTargetMachine', DataType.U32, [DataType.External], [client]);
}

export function Everything3_IsDBLoaded(client: ClientPtr): boolean {
  return ffiCall<number>('Everything3_IsDBLoaded', DataType.I32, [DataType.External], [client]) !== 0;
}

export function Everything3_GetLastError(): number {
  return ffiCall<number>('Everything3_GetLastError', DataType.U32, [], []);
}

// ─── Search State ──────────────────────────────────────────────────────────────

export function Everything3_CreateSearchState(): SearchStatePtr {
  ensureOpen();
  const ptr = load({
    library: libKey,
    funcName: 'Everything3_CreateSearchState',
    retType: DataType.External,
    paramsType: [],
    paramsValue: [],
  });
  return ptr;
}

export function Everything3_DestroySearchState(searchState: SearchStatePtr): void {
  ffiCall('Everything3_DestroySearchState', DataType.I32, [DataType.External], [searchState]);
}

export function Everything3_SetSearchTextW(searchState: SearchStatePtr, search: string): void {
  ffiCall('Everything3_SetSearchTextW', DataType.I32, [DataType.External, DataType.WString], [searchState, search]);
}

export function Everything3_SetSearchMatchCase(searchState: SearchStatePtr, matchCase: boolean): void {
  ffiCall('Everything3_SetSearchMatchCase', DataType.I32, [DataType.External, DataType.I32], [searchState, matchCase ? 1 : 0]);
}

export function Everything3_SetSearchMatchWholeWords(searchState: SearchStatePtr, matchWholeWords: boolean): void {
  ffiCall('Everything3_SetSearchMatchWholeWords', DataType.I32, [DataType.External, DataType.I32], [searchState, matchWholeWords ? 1 : 0]);
}

export function Everything3_SetSearchMatchPath(searchState: SearchStatePtr, matchPath: boolean): void {
  ffiCall('Everything3_SetSearchMatchPath', DataType.I32, [DataType.External, DataType.I32], [searchState, matchPath ? 1 : 0]);
}

export function Everything3_SetSearchMatchDiacritics(searchState: SearchStatePtr, matchDiacritics: boolean): void {
  ffiCall('Everything3_SetSearchMatchDiacritics', DataType.I32, [DataType.External, DataType.I32], [searchState, matchDiacritics ? 1 : 0]);
}

export function Everything3_SetSearchMatchPrefix(searchState: SearchStatePtr, matchPrefix: boolean): void {
  ffiCall('Everything3_SetSearchMatchPrefix', DataType.I32, [DataType.External, DataType.I32], [searchState, matchPrefix ? 1 : 0]);
}

export function Everything3_SetSearchMatchSuffix(searchState: SearchStatePtr, matchSuffix: boolean): void {
  ffiCall('Everything3_SetSearchMatchSuffix', DataType.I32, [DataType.External, DataType.I32], [searchState, matchSuffix ? 1 : 0]);
}

export function Everything3_SetSearchRegex(searchState: SearchStatePtr, regex: boolean): void {
  ffiCall('Everything3_SetSearchRegex', DataType.I32, [DataType.External, DataType.I32], [searchState, regex ? 1 : 0]);
}

export function Everything3_SetSearchViewportOffset(searchState: SearchStatePtr, offset: number): void {
  ffiCall('Everything3_SetSearchViewportOffset', DataType.I32, [DataType.External, DataType.U64], [searchState, offset]);
}

export function Everything3_SetSearchViewportCount(searchState: SearchStatePtr, count: number): void {
  ffiCall('Everything3_SetSearchViewportCount', DataType.I32, [DataType.External, DataType.U64], [searchState, count]);
}

export function Everything3_AddSearchSort(searchState: SearchStatePtr, propertyId: number, ascending: boolean): void {
  ffiCall('Everything3_AddSearchSort', DataType.I32, [DataType.External, DataType.U32, DataType.I32], [searchState, propertyId, ascending ? 1 : 0]);
}

export function Everything3_ClearSearchSorts(searchState: SearchStatePtr): void {
  ffiCall('Everything3_ClearSearchSorts', DataType.I32, [DataType.External], [searchState]);
}

export function Everything3_SetSearchFoldersFirst(searchState: SearchStatePtr, foldersFirstType: number): void {
  ffiCall('Everything3_SetSearchFoldersFirst', DataType.I32, [DataType.External, DataType.U32], [searchState, foldersFirstType]);
}

export function Everything3_SetSearchHideResultOmissions(searchState: SearchStatePtr, hideResultOmissions: boolean): void {
  ffiCall('Everything3_SetSearchHideResultOmissions', DataType.I32, [DataType.External, DataType.I32], [searchState, hideResultOmissions ? 1 : 0]);
}

// ─── Property Requests (required before GetResult* property getters work) ──────

export function Everything3_AddSearchPropertyRequest(searchState: SearchStatePtr, propertyId: number): void {
  ffiCall('Everything3_AddSearchPropertyRequest', DataType.I32, [DataType.External, DataType.U32], [searchState, propertyId]);
}

export function Everything3_ClearSearchPropertyRequests(searchState: SearchStatePtr): void {
  ffiCall('Everything3_ClearSearchPropertyRequests', DataType.I32, [DataType.External], [searchState]);
}

// ─── Execute Search ────────────────────────────────────────────────────────────

export function Everything3_Search(client: ClientPtr, searchState: SearchStatePtr): ResultListPtr {
  ensureOpen();
  const ptr = load({
    library: libKey,
    funcName: 'Everything3_Search',
    retType: DataType.External,
    paramsType: [DataType.External, DataType.External],
    paramsValue: [client, searchState],
  });
  return ptr;
}

export function Everything3_DestroyResultList(resultList: ResultListPtr): void {
  ffiCall('Everything3_DestroyResultList', DataType.I32, [DataType.External], [resultList]);
}

// ─── Result List Queries ──────────────────────────────────────────────────────

export function Everything3_GetResultListViewportCount(resultList: ResultListPtr): number {
  return ffiCall<number>('Everything3_GetResultListViewportCount', DataType.U64, [DataType.External], [resultList]);
}

export function Everything3_GetResultListCount(resultList: ResultListPtr): number {
  return ffiCall<number>('Everything3_GetResultListCount', DataType.U64, [DataType.External], [resultList]);
}

export function Everything3_GetResultListTotalSize(resultList: ResultListPtr): bigint {
  return ffiCall<bigint>('Everything3_GetResultListTotalSize', DataType.U64, [DataType.External], [resultList]);
}

export function Everything3_IsFolderResult(resultList: ResultListPtr, index: number): boolean {
  return ffiCall<number>('Everything3_IsFolderResult', DataType.I32, [DataType.External, DataType.U64], [resultList, index]) !== 0;
}

// ─── Get result strings (returns JS string from wide-char buffer) ──────────────

const MAX_PATH_WCHARS = 32768; // generous buffer for long Windows paths

/**
 * Call a function that fills a wide-char buffer and return the result as a JS string.
 * ffi-rs WideString return type handles the conversion for us when the DLL returns a pointer,
 * but for functions that fill a caller-provided buffer we need to use a buffer approach.
 *
 * Strategy: use ffi-rs's WideString retType.  Even for buffer-fill functions, the SDK returns
 * the number of chars written.  We pass a large buffer and use the return value to slice.
 */
function getWideStringFromBuffer(
  funcName: string,
  resultList: ResultListPtr,
  index: number,
  extraArgs: unknown[] = [],
): string {
  ensureOpen();
  // Allocate a wide-char buffer
  const buf = Buffer.alloc(MAX_PATH_WCHARS * 2); // UTF-16LE, 2 bytes per wchar
  const paramsType: DataType[] = [DataType.External, DataType.U64, ...extraArgs.map(() => DataType.External), DataType.U8Array, DataType.U64];
  const paramsValue: unknown[] = [resultList, index, ...extraArgs, buf, MAX_PATH_WCHARS];

  const charsWritten = load({
    library: libKey,
    funcName,
    retType: DataType.U64,
    paramsType,
    paramsValue,
  }) as number;

  if (charsWritten === 0) return '';

  // The buffer now contains the UTF-16LE string
  const byteLen = Math.min(charsWritten * 2, buf.length);
  return buf.toString('utf16le', 0, byteLen);
}

export function Everything3_GetResultFullPathNameW(resultList: ResultListPtr, index: number): string {
  return getWideStringFromBuffer('Everything3_GetResultFullPathNameW', resultList, index);
}

export function Everything3_GetResultNameW(resultList: ResultListPtr, index: number): string {
  return getWideStringFromBuffer('Everything3_GetResultNameW', resultList, index);
}

export function Everything3_GetResultPathW(resultList: ResultListPtr, index: number): string {
  return getWideStringFromBuffer('Everything3_GetResultPathW', resultList, index);
}

export function Everything3_GetResultExtensionW(resultList: ResultListPtr, index: number): string {
  return getWideStringFromBuffer('Everything3_GetResultExtensionW', resultList, index);
}

export function Everything3_GetResultTypeW(resultList: ResultListPtr, index: number): string {
  return getWideStringFromBuffer('Everything3_GetResultTypeW', resultList, index);
}

// ─── Result numeric properties ────────────────────────────────────────────────

export function Everything3_GetResultSize(resultList: ResultListPtr, index: number): bigint {
  return ffiCall<bigint>('Everything3_GetResultSize', DataType.U64, [DataType.External, DataType.U64], [resultList, index]);
}

export function Everything3_GetResultDateModified(resultList: ResultListPtr, index: number): bigint {
  return ffiCall<bigint>('Everything3_GetResultDateModified', DataType.U64, [DataType.External, DataType.U64], [resultList, index]);
}

export function Everything3_GetResultDateCreated(resultList: ResultListPtr, index: number): bigint {
  return ffiCall<bigint>('Everything3_GetResultDateCreated', DataType.U64, [DataType.External, DataType.U64], [resultList, index]);
}

export function Everything3_GetResultDateAccessed(resultList: ResultListPtr, index: number): bigint {
  return ffiCall<bigint>('Everything3_GetResultDateAccessed', DataType.U64, [DataType.External, DataType.U64], [resultList, index]);
}

export function Everything3_GetResultAttributes(resultList: ResultListPtr, index: number): number {
  return ffiCall<number>('Everything3_GetResultAttributes', DataType.U32, [DataType.External, DataType.U64], [resultList, index]);
}

export function Everything3_GetResultDateRecentlyChanged(resultList: ResultListPtr, index: number): bigint {
  return ffiCall<bigint>('Everything3_GetResultDateRecentlyChanged', DataType.U64, [DataType.External, DataType.U64], [resultList, index]);
}

export function Everything3_GetResultRunCount(resultList: ResultListPtr, index: number): number {
  return ffiCall<number>('Everything3_GetResultRunCount', DataType.U32, [DataType.External, DataType.U64], [resultList, index]);
}

export function Everything3_GetResultDateRun(resultList: ResultListPtr, index: number): bigint {
  return ffiCall<bigint>('Everything3_GetResultDateRun', DataType.U64, [DataType.External, DataType.U64], [resultList, index]);
}

// ─── File info by path ────────────────────────────────────────────────────────

export function Everything3_GetFileAttributesW(client: ClientPtr, filename: string): number {
  return ffiCall<number>('Everything3_GetFileAttributesW', DataType.U32, [DataType.External, DataType.WString], [client, filename]);
}

export function Everything3_GetRunCountFromFilenameW(client: ClientPtr, filename: string): number {
  return ffiCall<number>('Everything3_GetRunCountFromFilenameW', DataType.U32, [DataType.External, DataType.WString], [client, filename]);
}

// ─── Error helpers ────────────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<number, string> = {
  0x00000000: 'OK',
  0xE0000001: 'Out of memory',
  0xE0000002: 'IPC pipe server not found (Everything is not running)',
  0xE0000003: 'Disconnected from pipe server',
  0xE0000004: 'Invalid parameter',
  0xE0000005: 'Bad request',
  0xE0000006: 'User cancelled',
  0xE0000007: 'Property not found',
  0xE0000008: 'Server error (out of memory)',
  0xE0000009: 'Invalid command',
  0xE000000A: 'Bad server response',
  0xE000000B: 'Insufficient buffer',
  0xE000000C: 'Shutdown initiated by user',
  0xE000000D: 'Invalid property value type',
};

export function getErrorMessage(code: number): string {
  return ERROR_MESSAGES[code] ?? `Unknown error (0x${code.toString(16).toUpperCase()})`;
}

export function checkError(): void {
  const err = Everything3_GetLastError();
  if (err !== 0) {
    throw new Error(`Everything SDK error: ${getErrorMessage(err)} (code: 0x${err.toString(16).toUpperCase()})`);
  }
}

// ─── Utility: Windows FILETIME (100-ns intervals since 1601-01-01) → JS Date ──

/**
 * Convert a Windows FILETIME (UINT64, 100-nanosecond intervals since 1601-01-01 UTC)
 * to a JavaScript Date, or null if the value is 0 or UINT64_MAX.
 * Accepts both bigint and number (ffi-rs may return either for U64 types).
 */
export function filetimeToDate(ft: bigint | number): Date | null {
  const val = typeof ft === 'bigint' ? ft : BigInt(ft);
  if (val === 0n || val === 0xFFFFFFFFFFFFFFFFn || val === -1n) return null;
  // 100-ns intervals → milliseconds: divide by 10000
  // Epoch offset: 11644473600000 ms between 1601-01-01 and 1970-01-01
  const ms = Number(val / 10000n) - 11644473600000;
  return new Date(ms);
}

// ─── Property ID constants ────────────────────────────────────────────────────

export const PROPERTY_ID = {
  NAME: 0,
  PATH: 1,
  SIZE: 2,
  EXTENSION: 3,
  TYPE: 4,
  DATE_MODIFIED: 5,
  DATE_CREATED: 6,
  DATE_ACCESSED: 7,
  ATTRIBUTES: 8,
  DATE_RECENTLY_CHANGED: 9,
  RUN_COUNT: 10,
  DATE_RUN: 11,
  FILE_LIST_NAME: 12,
} as const;

// Target machine constants
export const TARGET_MACHINE = {
  UNKNOWN: 0,
  X86: 1,
  X64: 2,
  ARM: 3,
  ARM64: 4,
} as const;

export const TARGET_MACHINE_NAMES: Record<number, string> = {
  0: 'Unknown',
  1: 'x86',
  2: 'x64',
  3: 'ARM',
  4: 'ARM64',
};
