/**
 * Provider module barrel export
 */

import type { CommentProvider } from '../types/data';

export const providers = ['reddit', 'disqus', 'youtube', 'mal'] as CommentProvider[];

export * from './base-provider';
export * from './provider-manager';
export { DisqusProvider } from './disqus-provider';
export { RedditProvider } from './reddit-provider';
export { YouTubeProvider, setCurrentYouTubeVideo, getCurrentYouTubeVideo, setCurrentYouTubeOrder, getCurrentYouTubeOrder } from './youtube-provider';
export { MalProvider } from './mal-provider';
