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
  { value: 'mal', label: 'MyAnimeList' },
  { value: 'youtube', label: 'YouTube' },
] as const;

export type CommentProviderOption = (typeof commentProviderOptions)[number]['value'];
