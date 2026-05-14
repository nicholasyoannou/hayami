/**
 * Message handlers for the "publish custom sites" flow — GitHub/GitLab
 * OAuth device-flow / auth-code orchestration and the create/update/delete
 * Remote operations the popup invokes when the user publishes their custom
 * site mapping collection.
 *
 * Every handler here is a thin shim that delegates to a `*Auth` or
 * `publishProviders` util and returns the result via `sendResponse`.
 */

import {
  startGithubDeviceFlow,
  pollGithubDeviceFlow,
  setGithubPat,
  getGithubAuth,
  logoutGithub,
} from '@/utils/github/auth';
import {
  buildGitlabAuthorizeUrl,
  completeGitlabRedirectCallback,
  runGitlabAuthFlow,
  setGitlabPat,
  getGitlabAuth,
  logoutGitlab,
} from '@/utils/gitlab/auth';
import { createRemote, updateRemote, deleteRemote } from '@/utils/publishProviders';
import type { BackgroundMessageHandler } from './types';

export const publishHandlers: Record<string, BackgroundMessageHandler> = {
  hayami_publish_github_startDeviceFlow: (_msg, _sender, send) => {
    (async () => send(await startGithubDeviceFlow()))();
    return true;
  },
  hayami_publish_github_pollDeviceFlow: (msg, _sender, send) => {
    (async () => send(await pollGithubDeviceFlow(msg.deviceCode, msg.intervalMs || 5000)))();
    return true;
  },
  hayami_publish_github_setPat: (msg, _sender, send) => {
    (async () => send(await setGithubPat(msg.token || '')))();
    return true;
  },
  hayami_publish_github_getAuth: (_msg, _sender, send) => {
    (async () => send({ ok: true, state: await getGithubAuth() }))();
    return true;
  },
  hayami_publish_github_logout: (_msg, _sender, send) => {
    (async () => { await logoutGithub(); send({ ok: true }); })();
    return true;
  },
  hayami_publish_gitlab_buildAuthorizeUrl: (_msg, _sender, send) => {
    (async () => send(await buildGitlabAuthorizeUrl()))();
    return true;
  },
  hayami_publish_gitlab_runAuthFlow: (msg, _sender, send) => {
    (async () => send(await runGitlabAuthFlow({ openAs: msg.openAs })))();
    return true;
  },
  hayami_publish_gitlab_setPat: (msg, _sender, send) => {
    (async () => send(await setGitlabPat(msg.token || '')))();
    return true;
  },
  hayami_publish_gitlab_completeCallback: (msg, _sender, send) => {
    (async () => send(await completeGitlabRedirectCallback(msg.callbackUrl || '')))();
    return true;
  },
  hayami_publish_gitlab_getAuth: (_msg, _sender, send) => {
    (async () => send({ ok: true, state: await getGitlabAuth() }))();
    return true;
  },
  hayami_publish_gitlab_logout: (_msg, _sender, send) => {
    (async () => { await logoutGitlab(); send({ ok: true }); })();
    return true;
  },
  hayami_publish_createRemote: (msg, _sender, send) => {
    (async () => send(await createRemote(msg.provider, msg.name, msg.payload, msg.visibility)))();
    return true;
  },
  hayami_publish_updateRemote: (msg, _sender, send) => {
    (async () => send(await updateRemote(msg.provider, msg.remoteId, msg.name, msg.payload)))();
    return true;
  },
  hayami_publish_deleteRemote: (msg, _sender, send) => {
    (async () => send(await deleteRemote(msg.provider, msg.remoteId)))();
    return true;
  },
};
