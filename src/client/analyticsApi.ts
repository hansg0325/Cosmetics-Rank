import { useEffect, useState } from "react";
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
    const controller = new AbortController();
    setState({ path, data: null, error: "", loading: true });
    fetch("/api/" + path, { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw Error(
            (data as { message?: string; error?: string }).message ||
              (data as { error?: string }).error ||
              "조회 실패",
          );
        return data as T;
      })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ path, data, error: "", loading: false });
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
