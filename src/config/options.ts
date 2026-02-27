export const displayModeOptions = [
  { value: 'below', label: 'Below element' },
  { value: 'insert', label: 'Insert inline' },
  { value: 'replace', label: 'Replace element' },
  { value: 'popup', label: 'Popup only' },
  { value: 'icon', label: 'Icon toggle' },
] as const;

export type DisplayModeOption = (typeof displayModeOptions)[number]['value'];

export const commentProviderOptions = [
  { value: 'reddit', label: 'Reddit' },
  { value: 'disqus', label: 'Disqus' },
  { value: 'animecommunity', label: 'The Anime Community' },
  { value: 'aniwave', label: 'Aniwave' },
  { value: 'anilist', label: 'AniList forums' },
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
