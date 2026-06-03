/**
 * Single source of truth for the "Wrong anime?" event dispatched by every
 * provider. Centralizes the previously-inconsistent mapping between each
 * provider's `WrongAnimeContext` and the on-the-wire `ManualSearchRequestDetail`
 * the modal handler reads — see the type docstrings in `../types/data.ts`
 * for the convention.
 */

import { EVENTS } from '../constants';
import type {
  CommentProvider,
  ManualSearchRequestDetail,
  WrongAnimeContext,
} from '../types/data';

export interface DispatchManualSearchOptions {
  /** Reddit flow only — the discussion the user was browsing. */
  discussion?: { title?: string; permalink?: string };
  /**
   * Skip the per-provider episode preflight and pop the wrong-anime search
   * overlay immediately. Set by callers that already know the auto-detected
   * anime is wrong (e.g. the YouTube not-found view).
   */
  openWrongAnimeImmediately?: boolean;
}

export function buildManualSearchRequestDetail(
  provider: CommentProvider,
  context: WrongAnimeContext,
  options?: DispatchManualSearchOptions,
): ManualSearchRequestDetail {
  return {
    provider,
    animeInfo: {
      animeName: context.animeName,
      episodeName: context.episodeName,
      malId: context.malId ?? null,
      anilistId: context.anilistId ?? null,
    },
    // Mirror animeName so the handler's `mappingAnimeName || animeInfo.animeName`
    // fallback resolves to the storage key regardless of which branch fires.
    mappingAnimeName: context.animeName,
    resolvedAnimeName: context.resolvedAnimeName,
    episodeNumber: context.episodeNumber,
    discussion: options?.discussion,
    openWrongAnimeImmediately: options?.openWrongAnimeImmediately,
  };
}

export function dispatchManualSearchRequest(
  provider: CommentProvider,
  context: WrongAnimeContext,
  options?: DispatchManualSearchOptions,
): void {
  window.dispatchEvent(
    new CustomEvent(EVENTS.MANUAL_SEARCH_REQUESTED, {
      detail: buildManualSearchRequestDetail(provider, context, options),
    }),
  );
}
