import { useEffect, useState } from "react";
const DATA_CACHE_TTL_MS = 30_000;
const DATA_CACHE_MAX_ENTRIES = 100;
type DataCacheEntry = { data: unknown; expiresAt: number };
const dataCache = new Map<string, DataCacheEntry>();
let dataCacheGeneration = 0;

function readCachedData(path: string) {
  const entry = dataCache.get(path);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    dataCache.delete(path);
    return undefined;
  }
  dataCache.delete(path);
  dataCache.set(path, entry);
  return entry.data;
}

function storeCachedData(path: string, data: unknown) {
  dataCache.delete(path);
  dataCache.set(path, { data, expiresAt: Date.now() + DATA_CACHE_TTL_MS });
  while (dataCache.size > DATA_CACHE_MAX_ENTRIES) {
    const oldest = dataCache.keys().next().value;
    if (oldest === undefined) break;
    dataCache.delete(oldest);
  }
}

export async function getData<T>(path: string, signal?: AbortSignal): Promise<T> {
  const cached = readCachedData(path);
  if (cached !== undefined) return cached as T;

  const generation = dataCacheGeneration;
  const response = await fetch("/api/" + path, { signal });
  const data: unknown = await response.json();
  if (!response.ok) {
    const errorData = data as { message?: string; error?: string };
    throw Error(errorData.message || errorData.error || "조회 실패");
  }
  if (generation === dataCacheGeneration) storeCachedData(path, data);
  return data as T;
}

export function invalidateDataCache() {
  dataCacheGeneration += 1;
  dataCache.clear();
}

export function useDebouncedValue(value: string) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setResult(value), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return result;
}
export function useData<T>(path: string | null) {
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ path: null, data: null, error: "", loading: false });
  useEffect(() => {
    if (!path) return;
    const cached = readCachedData(path);
    if (cached !== undefined) {
      setState({ path, data: cached as T, error: "", loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ path, data: null, error: "", loading: true });
    getData<T>(path, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ path, data, error: "", loading: false });
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setState({ path, data: null, error: String(e), loading: false });
      });
    return () => controller.abort();
  }, [path]);
  return state.path === path
    ? state
    : { path, data: null, error: "", loading: !!path };
}
export const params = (input: Record<string, string | number>) =>
  new URLSearchParams(
    Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v)])),
  ).toString();
