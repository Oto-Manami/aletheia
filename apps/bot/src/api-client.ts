// API（apps/api）を呼ぶ

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClient {
  resolve(url: string): Promise<{ channel_key: string; external_id: string } | null>;
  createIntake(body: {
    channel_key: string;
    external_id: string;
    route: "discord";
    route_ref: string;
    captured_at: string;
    draft: unknown;
    staged_files: unknown[];
  }): Promise<{ id: string; draft_valid: boolean; issues: unknown[] }>;
  getIntake(id: string): Promise<{
    item: { id: string; draft: unknown; state: string; external_id: string };
    draft_valid: boolean;
    issues: { path?: (string | number)[]; message?: string }[];
  }>;
  decide(id: string, action: "approve" | "reject" | "hold", reviewerId: string): Promise<unknown>;
  /** ファイルを API に渡して、承認待ちの場所に保存してもらう */
  stage(
    bytes: Uint8Array,
    meta: { ref: string; index: number; name: string; contentType: string | null },
  ): Promise<StagedFile>;
}

export interface StagedFile {
  provider: string;
  storage_key: string;
  sha256: string;
  size: number;
  name: string;
  staged_name: string;
  content_type: string | null;
}

export function createApiClient(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): ApiClient {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(new URL(path, baseUrl), {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (json as { error?: string }).error ?? `API のエラーです（${res.status}）`;
      throw new ApiError(res.status, message, json);
    }
    return json as T;
  }

  return {
    async resolve(url) {
      try {
        return await call("POST", "/resolve", { url });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    createIntake: (body) => call("POST", "/intake", body),
    getIntake: (id) => call("GET", `/intake/${id}`),
    decide: (id, action, reviewerId) =>
      call("POST", `/intake/${id}/${action}`, { reviewer_id: reviewerId }),
    async stage(bytes, meta) {
      const params = new URLSearchParams({
        route: "discord",
        ref: meta.ref,
        index: String(meta.index),
        name: meta.name,
      });
      const res = await fetchImpl(new URL(`/files/staging?${params.toString()}`, baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": meta.contentType ?? "application/octet-stream",
        },
        body: bytes,
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          (json as { error?: string }).error ?? `ファイルを保存できません（${res.status}）`;
        throw new ApiError(res.status, message, json);
      }
      return json as StagedFile;
    },
  };
}
