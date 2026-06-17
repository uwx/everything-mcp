/**
 * everything-client.ts — High-level wrapper around the Everything SDK FFI bindings.
 *
 * Manages lifecycle (connect / disconnect) and provides a clean async-friendly API
 * for searching and retrieving file information.
 */

import * as ffi from './ffi-bindings.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  /** Search query string (Everything search syntax). */
  query: string;
  /** Maximum number of results to return (default 50, max 1000). */
  maxResults?: number;
  /** Zero-based offset into the result set (for pagination). */
  offset?: number;
  /** Match case (default false). */
  matchCase?: boolean;
  /** Match whole words (default false). */
  matchWholeWord?: boolean;
  /** Match path in addition to filename (default false). */
  matchPath?: boolean;
  /** Match diacritics (default false). */
  matchDiacritics?: boolean;
  /** Use regex search (default false). */
  regex?: boolean;
  /** Sort by property ID (default: sort by name ascending). */
  sortPropertyId?: number;
  /** Sort ascending? (default true). */
  sortAscending?: boolean;
}

export interface SearchResult {
  /** Full path and file name. */
  fullPath: string;
  /** File name only. */
  name: string;
  /** Path only (no trailing backslash). */
  path: string;
  /** File extension. */
  extension: string;
  /** Type description (e.g., "Text Document"). */
  type: string;
  /** File size in bytes (as bigint). */
  size: bigint;
  /** True if this result is a folder. */
  isFolder: boolean;
  /** Date modified (or null if unavailable). */
  dateModified: Date | null;
  /** Date created (or null if unavailable). */
  dateCreated: Date | null;
  /** Date accessed (or null if unavailable). */
  dateAccessed: Date | null;
  /** Windows file attributes. */
  attributes: number;
  /** Run count. */
  runCount: number;
}

export interface VersionInfo {
  major: number;
  minor: number;
  revision: number;
  build: number;
  targetMachine: string;
}

export interface FileInfo {
  /** Windows file attributes. */
  attributes: number;
  /** Run count from Everything. */
  runCount: number;
}

// ─── Client Class ──────────────────────────────────────────────────────────────

export class EverythingClient {
  private client: unknown | null = null;
  private _connected = false;
  private _instanceName: string | null = null;

  /**
   * Connect to the local Everything service.
   * Everything must be running for this to succeed.
   *
   * If EVERYTHING_IPC_PIPE_NAME is set, that instance name is used directly.
   * Otherwise auto-detects the correct named instance by trying common names
   * (null/"", "1.5a", "1.5") and picking the first one with a loaded database.
   */
  connect(): void {
    if (this._connected) return;

    // If user specified an instance name, use it directly — no probing.
    const envInstance = process.env.EVERYTHING_IPC_PIPE_NAME;
    if (envInstance !== undefined) {
      this._connectOne(envInstance || null);
      this._instanceName = envInstance || null;
      return;
    }

    // Auto-detect: try candidate instance names in order, keep first with DB loaded.
    const candidates: (string | null)[] = [null, '1.5a', '1.5'];
    for (const name of candidates) {
      try {
        this._connectOne(name);
        if (this.client && ffi.Everything3_IsDBLoaded(this.client) && ffi.Everything3_GetMajorVersion(this.client) !== 0) {
          this._instanceName = name;
          return; // success — found the right instance
        }
        // Wrong instance — disconnect and try next
        ffi.Everything3_DestroyClient(this.client!);
        this.client = null;
        this._connected = false;
      } catch {
        // try next candidate
      }
    }

    // Fallback: keep the first candidate (null) connection so error messages are useful
    try {
      this._connectOne(null);
      this._instanceName = null;
    } catch {
      throw new Error('Failed to connect to Everything. Is Everything running?');
    }
  }

  /** Connect to a specific instance name. Internal — does not check _connected guard. */
  private _connectOne(instanceName: string | null): void {
    this.client = ffi.Everything3_ConnectW(instanceName ?? null);

    if (!this.client) {
      ffi.checkError();
      throw new Error('Failed to connect to Everything. Is Everything running?');
    }

    this._connected = true;
  }

  /** Disconnect from Everything and free resources. */
  disconnect(): void {
    if (!this._connected || !this.client) return;

    try {
      ffi.Everything3_DestroyClient(this.client);
    } catch {
      // Ignore errors during cleanup
    }
    this.client = null;
    this._connected = false;
  }

  get connected(): boolean {
    return this._connected;
  }

  /** The Everything instance name this client connected to (null = default unnamed instance). */
  get instanceName(): string | null {
    return this._instanceName;
  }

  /** Check if the Everything database is loaded and ready. */
  isDBLoaded(): boolean {
    this.ensureConnected();
    return ffi.Everything3_IsDBLoaded(this.client!);
  }

  /**
   * Wait for the Everything database to finish loading.
   * Polls `isDBLoaded()` until it returns true or the timeout expires.
   *
   * @param timeoutMs Maximum time to wait in milliseconds (default: 10000).
   * @param pollIntervalMs How often to check in milliseconds (default: 250).
   * @returns true if the DB loaded within the timeout, false otherwise.
   */
  async waitForDBLoaded(timeoutMs = 10000, pollIntervalMs = 250): Promise<boolean> {
    this.ensureConnected();

    if (this.isDBLoaded()) return true;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      if (this.isDBLoaded()) return true;
    }
    return false;
  }

  /** Get Everything version information. */
  getVersion(): VersionInfo {
    this.ensureConnected();
    const targetMachine = ffi.Everything3_GetTargetMachine(this.client!);
    return {
      major: ffi.Everything3_GetMajorVersion(this.client!),
      minor: ffi.Everything3_GetMinorVersion(this.client!),
      revision: ffi.Everything3_GetRevision(this.client!),
      build: ffi.Everything3_GetBuildNumber(this.client!),
      targetMachine: ffi.TARGET_MACHINE_NAMES[targetMachine] ?? `Unknown (${targetMachine})`,
    };
  }

  /**
   * Search for files/folders using Everything search syntax.
   *
   * Examples:
   *   - `search({ query: '*.txt' })` — all .txt files
   *   - `search({ query: 'foo bar', matchWholeWord: true })` — files containing "foo" AND "bar"
   *   - `search({ query: 'ext:jpg size:>1mb' })` — JPEGs larger than 1 MB
   *   - `search({ query: 'folder:Downloads', matchPath: true })` — items under Downloads
   */
  search(options: SearchOptions): SearchResult[] {
    this.ensureConnected();

    const maxResults = Math.min(options.maxResults ?? 50, 1000);
    const offset = options.offset ?? 0;

    // Create and configure search state
    const searchState = ffi.Everything3_CreateSearchState();
    if (!searchState) {
      throw new Error('Failed to create Everything search state');
    }

    try {
      // Configure search
      ffi.Everything3_SetSearchTextW(searchState, options.query);
      ffi.Everything3_SetSearchMatchCase(searchState, options.matchCase ?? false);
      ffi.Everything3_SetSearchMatchWholeWords(searchState, options.matchWholeWord ?? false);
      ffi.Everything3_SetSearchMatchPath(searchState, options.matchPath ?? false);
      ffi.Everything3_SetSearchMatchDiacritics(searchState, options.matchDiacritics ?? false);
      ffi.Everything3_SetSearchRegex(searchState, options.regex ?? false);

      // Request all properties we plan to read from results.
      // Without these, individual property getters return default/invalid values.
      ffi.Everything3_ClearSearchPropertyRequests(searchState);
      ffi.Everything3_AddSearchPropertyRequest(searchState, ffi.PROPERTY_ID.NAME);
      ffi.Everything3_AddSearchPropertyRequest(searchState, ffi.PROPERTY_ID.PATH);
      ffi.Everything3_AddSearchPropertyRequest(searchState, ffi.PROPERTY_ID.SIZE);
      ffi.Everything3_AddSearchPropertyRequest(searchState, ffi.PROPERTY_ID.EXTENSION);
      ffi.Everything3_AddSearchPropertyRequest(searchState, ffi.PROPERTY_ID.TYPE);
      ffi.Everything3_AddSearchPropertyRequest(searchState, ffi.PROPERTY_ID.DATE_MODIFIED);
      ffi.Everything3_AddSearchPropertyRequest(searchState, ffi.PROPERTY_ID.DATE_CREATED);
      ffi.Everything3_AddSearchPropertyRequest(searchState, ffi.PROPERTY_ID.DATE_ACCESSED);
      ffi.Everything3_AddSearchPropertyRequest(searchState, ffi.PROPERTY_ID.ATTRIBUTES);
      ffi.Everything3_AddSearchPropertyRequest(searchState, ffi.PROPERTY_ID.RUN_COUNT);

      // Pagination
      ffi.Everything3_SetSearchViewportOffset(searchState, offset);
      ffi.Everything3_SetSearchViewportCount(searchState, maxResults);

      // Sorting
      if (options.sortPropertyId !== undefined) {
        ffi.Everything3_ClearSearchSorts(searchState);
        ffi.Everything3_AddSearchSort(searchState, options.sortPropertyId, options.sortAscending ?? true);
      }

      // Execute search
      const resultList = ffi.Everything3_Search(this.client!, searchState);
      if (!resultList) {
        ffi.checkError();
        return [];
      }

      try {
        const count = ffi.Everything3_GetResultListViewportCount(resultList);
        const results: SearchResult[] = [];

        for (let i = 0; i < count; i++) {
          try {
            const name = ffi.Everything3_GetResultNameW(resultList, i);
            const path = ffi.Everything3_GetResultPathW(resultList, i);
            const attrs = ffi.Everything3_GetResultAttributes(resultList, i);
            const dateModified = ffi.filetimeToDate(ffi.Everything3_GetResultDateModified(resultList, i));
            const dateCreated = ffi.filetimeToDate(ffi.Everything3_GetResultDateCreated(resultList, i));
            const dateAccessed = ffi.filetimeToDate(ffi.Everything3_GetResultDateAccessed(resultList, i));

            // Build full path from path + name (more reliable than the convenience
            // function when property requests are active).
            const fullPath = path && name ? `${path}\\${name}` : ffi.Everything3_GetResultFullPathNameW(resultList, i);

            results.push({
              fullPath,
              name,
              path,
              extension: ffi.Everything3_GetResultExtensionW(resultList, i),
              type: ffi.Everything3_GetResultTypeW(resultList, i),
              size: ffi.Everything3_GetResultSize(resultList, i),
              // Use FILE_ATTRIBUTE_DIRECTORY (0x10) — more reliable than IsFolderResult
              isFolder: (attrs & 0x10) !== 0,
              dateModified,
              dateCreated,
              dateAccessed,
              attributes: attrs,
              runCount: ffi.Everything3_GetResultRunCount(resultList, i),
            });
          } catch {
            // Skip individual result errors
            results.push({
              fullPath: `[Error reading result ${i}]`,
              name: '',
              path: '',
              extension: '',
              type: '',
              size: 0n,
              isFolder: false,
              dateModified: null,
              dateCreated: null,
              dateAccessed: null,
              attributes: 0,
              runCount: 0,
            });
          }
        }

        return results;
      } finally {
        ffi.Everything3_DestroyResultList(resultList);
      }
    } finally {
      ffi.Everything3_DestroySearchState(searchState);
    }
  }

  /** Get file attributes and run count for a specific file path. */
  getFileInfo(filePath: string): FileInfo | null {
    this.ensureConnected();

    const attrs = ffi.Everything3_GetFileAttributesW(this.client!, filePath);
    if (attrs === 0xFFFFFFFF) {
      // INVALID_FILE_ATTRIBUTES
      return null;
    }

    const runCount = ffi.Everything3_GetRunCountFromFilenameW(this.client!, filePath);

    return { attributes: attrs, runCount };
  }

  private ensureConnected(): void {
    if (!this._connected || !this.client) {
      throw new Error('Not connected to Everything. Call connect() first.');
    }
  }
}
