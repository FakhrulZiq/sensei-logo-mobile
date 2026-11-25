import { idToken } from './auth';

export type Kind = 'banks' | 'brands';
export type Logo = { url: string; sha256: string; width: number; height: number };
export type Entry = {
  id: string;
  name: string;
  short: string;
  colour: string;
  aliases: string[];
  category: string;
  sortOrder: number;
  logo: Logo | null;
  group?: string;
  commitment?: { kind: string; loanType?: string } | null;
};
export type EntryInput = Omit<Entry, 'logo'>;
type Page = { data: Entry[]; nextPage?: number; total?: number };

const apiUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!apiUrl) throw new ApiError('Set VITE_API_URL before building the app.');
  const token = await idToken();
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Could not reach the SenSei API. Check your connection.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
    const detail = Array.isArray(payload?.message) ? payload.message[0] : payload?.message;
    throw new ApiError(detail || `Request failed (${response.status}).`, response.status);
  }
  return response.json() as Promise<T>;
}

function json(method: string, data: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

export async function listEntries(kind: Kind): Promise<Entry[]> {
  const all: Entry[] = [];
  let pageNum = 1;
  while (true) {
    const page = await request<Page>(`/catalog/${kind}/list`, json('POST', { pageNum, pageSize: 100 }));
    all.push(...page.data);
    if (!page.nextPage) return all;
    pageNum = page.nextPage;
  }
}

export async function saveEntry(kind: Kind, entry: EntryInput, isNew: boolean) {
  const path = isNew ? `/catalog/${kind}/add` : `/catalog/${kind}/${encodeURIComponent(entry.id)}`;
  return request(path, json(isNew ? 'POST' : 'PUT', entry));
}

export async function uploadLogo(kind: Kind, id: string, file: File) {
  const form = new FormData();
  form.append('file', file, file.name);
  return request(`/catalog/${kind}/${encodeURIComponent(id)}/logo`, { method: 'POST', body: form });
}

export async function deleteEntry(kind: Kind, id: string) {
  return request(`/catalog/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function publishCatalog() {
  return request<{ version: number; publishedAt: string }>('/catalog/publish', { method: 'POST' });
}
