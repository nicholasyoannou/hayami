export const displayModeOptions = [
  { value: 'below', label: 'Below element' },
  { value: 'insert', label: 'Insert inline' },
  { value: 'replace', label: 'Replace element' },
  { value: 'popup', label: 'Popup only' },
] as const;

export type DisplayModeOption = (typeof displayModeOptions)[number]['value'];

export const commentProviderOptions = [
  { value: 'reddit', label: 'Reddit' },
  { value: 'disqus', label: 'Disqus' },
  { value: 'animecommunity', label: 'The Anime Community' },
  { value: 'aniwave', label: 'Aniwave' },
  { value: 'anilist', label: 'AniList' },
  { value: 'mal', label: 'MyAnimeList' },
  { value: 'youtube', label: 'YouTube' },
] as const;

export type CommentProviderOption = (typeof commentProviderOptions)[number]['value'];

export const redditEditorOptions = [
  { value: 'editor', label: 'Rich editor' },
  { value: 'markdown', label: 'Plain markdown box' },
] as const;

export type RedditEditorMode = (typeof redditEditorOptions)[number]['value'];

export const redditSortOptions = [
  { value: 'confidence', label: 'Best' },
  { value: 'top', label: 'Top' },
  { value: 'controversial', label: 'Controversial' },
  { value: 'new', label: 'New' },
  { value: 'old', label: 'Old' },
  { value: 'qa', label: 'Q&A' },
] as const;

export type RedditSortOption = (typeof redditSortOptions)[number]['value'];

export const redditFlairPositionOptions = [
  { value: 'inline', label: 'Inline with username' },
  { value: 'below', label: 'Below username' },
] as const;

export type RedditFlairPositionOption = (typeof redditFlairPositionOptions)[number]['value'];

export const redditDeepReplyModeOptions = [
  { value: 'popup', label: 'Open in Hayami popup' },
  { value: 'reddit', label: 'Open on Reddit' },
] as const;

export type RedditDeepReplyModeOption = (typeof redditDeepReplyModeOptions)[number]['value'];

export const redditCommentLayoutOptions = [
  { value: 'threaded', label: 'Threaded (Reddit-style)' },
  { value: 'traditional', label: 'Traditional (nested)' },
  { value: 'compact', label: 'Compact' },
  { value: 'classic', label: 'Classic (old Reddit)' },
] as const;

export type RedditCommentLayoutOption = (typeof redditCommentLayoutOptions)[number]['value'];

export const redditLinkDomainOptions = [
  { value: 'reddit', label: 'reddit.com' },
  { value: 'old', label: 'old.reddit.com' },
] as const;

export type RedditLinkDomainOption = (typeof redditLinkDomainOptions)[number]['value'];

export const wrongAnimeTitleFormatOptions = [
  { value: 'romaji', label: 'Romaji only' },
  { value: 'english', label: 'English only' },
  { value: 'both', label: 'Romaji and English' },
] as const;

export type WrongAnimeTitleFormatOption = (typeof wrongAnimeTitleFormatOptions)[number]['value'];
