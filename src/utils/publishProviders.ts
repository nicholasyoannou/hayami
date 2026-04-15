/**
 * Provider-agnostic CRUD for hosting a JSON payload as a gist / snippet.
 *
 * The "publish format" written to the remote is byte-identical to the existing
 * manual export format produced by useCustomSiteManagement.exportAllCustomSiteMappings
 * — this means consumers can subscribe to the raw URL using the already-built
 * Custom Sites Sync feature, no consumer-side changes needed.
 */

import type { PublishProviderId, PublishedVisibility } from '@/config/storage';
import { getGithubAuth } from '@/utils/githubPublishAuth';
import { getGitlabAuth } from '@/utils/gitlabPublishAuth';
import type { CustomSiteMapping } from '@/entrypoints/content/ui/site-mapper/types';

export const PUBLISH_FILENAME = 'hayami-custom-sites.json';

export type PublishPayload = {
  format: 'hayami.custom-site-mappings';
  version: 1;
  exportedAt: string;
  name: string;
  mappings: CustomSiteMapping[];
};

export function buildPublishPayload(name: string, mappings: CustomSiteMapping[]): PublishPayload {
  return {
    format: 'hayami.custom-site-mappings',
    version: 1,
    exportedAt: new Date().toISOString(),
    name,
    mappings,
  };
}

export async function hashPayload(payload: PublishPayload): Promise<string> {
  const { exportedAt: _exportedAt, ...rest } = payload;
  const json = JSON.stringify(rest);
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type CreateRemoteResult =
  | { ok: true; remoteId: string; rawUrl: string; htmlUrl: string }
  | { ok: false; error: string };

export type UpdateRemoteResult =
  | { ok: true; rawUrl: string; htmlUrl: string }
  | { ok: false; error: string };

export type DeleteRemoteResult = { ok: true } | { ok: false; error: string };

// ── GitHub Gist ──────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';

async function githubHeaders(): Promise<Record<string, string> | null> {
  const auth = await getGithubAuth();
  if (!auth?.accessToken) return null;
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${auth.accessToken}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function createGithubGist(
  name: string,
  payload: PublishPayload,
  visibility: PublishedVisibility,
): Promise<CreateRemoteResult> {
  const headers = await githubHeaders();
  if (!headers) return { ok: false, error: 'Not signed in to GitHub.' };

  const resp = await fetch(`${GITHUB_API}/gists`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      description: `Hayami custom sites — ${name}`,
      public: visibility === 'public',
      files: {
        [PUBLISH_FILENAME]: { content: JSON.stringify(payload, null, 2) },
      },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, error: `GitHub rejected the request (${resp.status}): ${text.slice(0, 200)}` };
  }
  const data = await resp.json();
  const file = data.files?.[PUBLISH_FILENAME];
  if (!file?.raw_url) return { ok: false, error: 'GitHub response missing raw_url.' };
  return { ok: true, remoteId: data.id, rawUrl: stripGistRevision(file.raw_url), htmlUrl: data.html_url };
}

async function updateGithubGist(
  remoteId: string,
  name: string,
  payload: PublishPayload,
): Promise<UpdateRemoteResult> {
  const headers = await githubHeaders();
  if (!headers) return { ok: false, error: 'Not signed in to GitHub.' };

  const resp = await fetch(`${GITHUB_API}/gists/${remoteId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      description: `Hayami custom sites — ${name}`,
      files: {
        [PUBLISH_FILENAME]: { content: JSON.stringify(payload, null, 2) },
      },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, error: `GitHub rejected the update (${resp.status}): ${text.slice(0, 200)}` };
  }
  const data = await resp.json();
  const file = data.files?.[PUBLISH_FILENAME];
  if (!file?.raw_url) return { ok: false, error: 'GitHub response missing raw_url.' };
  return { ok: true, rawUrl: stripGistRevision(file.raw_url), htmlUrl: data.html_url };
}

async function deleteGithubGist(remoteId: string): Promise<DeleteRemoteResult> {
  const headers = await githubHeaders();
  if (!headers) return { ok: false, error: 'Not signed in to GitHub.' };
  const resp = await fetch(`${GITHUB_API}/gists/${remoteId}`, { method: 'DELETE', headers });
  if (!resp.ok && resp.status !== 404) {
    return { ok: false, error: `Delete failed (${resp.status}).` };
  }
  return { ok: true };
}

/**
 * GitHub's raw_url is pinned to a specific revision sha, so sharing it would
 * freeze content at creation time. Strip the sha segment so the URL always
 * serves the latest revision.
 *
 * Pattern: https://gist.githubusercontent.com/<user>/<gist-id>/raw/<sha>/<filename>
 *       → https://gist.githubusercontent.com/<user>/<gist-id>/raw/<filename>
 */
function stripGistRevision(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    // [user, gistId, 'raw', sha, filename]
    if (parts.length >= 5 && parts[2] === 'raw' && /^[0-9a-f]{7,40}$/i.test(parts[3])) {
      parts.splice(3, 1);
      url.pathname = '/' + parts.join('/');
      return url.toString();
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

// ── GitLab Snippet ───────────────────────────────────────────────────────

const GITLAB_API = 'https://gitlab.com/api/v4';

async function gitlabHeaders(): Promise<Record<string, string> | null> {
  const auth = await getGitlabAuth();
  if (!auth?.accessToken) return null;
  return {
    'Accept': 'application/json',
    'Authorization': `Bearer ${auth.accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function createGitlabSnippet(
  name: string,
  payload: PublishPayload,
  visibility: PublishedVisibility,
): Promise<CreateRemoteResult> {
  const headers = await gitlabHeaders();
  if (!headers) return { ok: false, error: 'Not signed in to GitLab.' };

  const resp = await fetch(`${GITLAB_API}/snippets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `Hayami custom sites — ${name}`,
      description: 'Managed by Hayami Komento — edits here will be overwritten.',
      visibility: visibility === 'public' ? 'public' : 'private',
      files: [
        { file_path: PUBLISH_FILENAME, content: JSON.stringify(payload, null, 2) },
      ],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, error: `GitLab rejected the request (${resp.status}): ${text.slice(0, 200)}` };
  }
  const data = await resp.json();
  return {
    ok: true,
    remoteId: String(data.id),
    rawUrl: `${GITLAB_API}/snippets/${data.id}/files/main/${encodeURIComponent(PUBLISH_FILENAME)}/raw`,
    htmlUrl: data.web_url,
  };
}

async function updateGitlabSnippet(
  remoteId: string,
  name: string,
  payload: PublishPayload,
): Promise<UpdateRemoteResult> {
  const headers = await gitlabHeaders();
  if (!headers) return { ok: false, error: 'Not signed in to GitLab.' };

  const resp = await fetch(`${GITLAB_API}/snippets/${remoteId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      title: `Hayami custom sites — ${name}`,
      files: [
        { action: 'update', file_path: PUBLISH_FILENAME, content: JSON.stringify(payload, null, 2) },
      ],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, error: `GitLab rejected the update (${resp.status}): ${text.slice(0, 200)}` };
  }
  const data = await resp.json();
  return {
    ok: true,
    rawUrl: `${GITLAB_API}/snippets/${remoteId}/files/main/${encodeURIComponent(PUBLISH_FILENAME)}/raw`,
    htmlUrl: data.web_url,
  };
}

async function deleteGitlabSnippet(remoteId: string): Promise<DeleteRemoteResult> {
  const headers = await gitlabHeaders();
  if (!headers) return { ok: false, error: 'Not signed in to GitLab.' };
  const resp = await fetch(`${GITLAB_API}/snippets/${remoteId}`, { method: 'DELETE', headers });
  if (!resp.ok && resp.status !== 404) {
    return { ok: false, error: `Delete failed (${resp.status}).` };
  }
  return { ok: true };
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export async function createRemote(
  provider: PublishProviderId,
  name: string,
  payload: PublishPayload,
  visibility: PublishedVisibility,
): Promise<CreateRemoteResult> {
  return provider === 'github'
    ? createGithubGist(name, payload, visibility)
    : createGitlabSnippet(name, payload, visibility);
}

export async function updateRemote(
  provider: PublishProviderId,
  remoteId: string,
  name: string,
  payload: PublishPayload,
): Promise<UpdateRemoteResult> {
  return provider === 'github'
    ? updateGithubGist(remoteId, name, payload)
    : updateGitlabSnippet(remoteId, name, payload);
}

export async function deleteRemote(
  provider: PublishProviderId,
  remoteId: string,
): Promise<DeleteRemoteResult> {
  return provider === 'github'
    ? deleteGithubGist(remoteId)
    : deleteGitlabSnippet(remoteId);
}
