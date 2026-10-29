export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export const errors = {
  bad: (message: string) => json({ error: message }, 400),
  forbidden: () => json({ error: "Not allowed." }, 403),
  notFound: () => json({ error: "Not found." }, 404),
  tooMany: () => json({ error: "Too many requests. Try again in a minute." }, 429, { "Retry-After": "60" }),
};

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
