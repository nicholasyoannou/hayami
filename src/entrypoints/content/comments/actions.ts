/**
 * Comment action bar rendering (votes, reply, share)
 */

/**
 * SVG icons for comment actions
 */
export const ACTION_ICONS = {
  upvote: `<svg class="ri-icon ri-icon-up" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <g><path d="M10 19a3.966 3.966 0 01-3.96-3.962V10.98H2.838a1.731 1.731 0 01-1.605-1.073 1.734 1.734 0 01.377-1.895L9.364.254a.925.925 0 011.272 0l7.754 7.759c.498.499.646 1.242.376 1.894-.27.652-.9 1.073-1.605 1.073h-3.202v4.058A3.965 3.965 0 019.999 19H10zM2.989 9.179H7.84v5.731c0 1.13.81 2.163 1.934 2.278a2.163 2.163 0 002.386-2.15V9.179h4.851L10 2.163 2.989 9.179z"></path></g>
    <g class="filled"><path d="M10 19a3.966 3.966 0 01-3.96-3.962V10.98H2.838a1.731 1.731 0 01-1.605-1.073 1.734 1.734 0 01.377-1.895L9.364.254a.925.925 0 011.272 0l7.754 7.759c.498.499.646 1.242.376 1.894-.27.652-.9 1.073-1.605 1.073h-3.202v4.058A3.965 3.965 0 019.999 19H10z"></path></g>
  </svg>`,

  downvote: `<svg class="ri-icon ri-icon-down" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <g><path d="M10 1a3.966 3.966 0 013.96 3.962V9.02h3.202c.706 0 1.335.42 1.605 1.073.27.652.122 1.396-.377 1.895l-7.754 7.759a.925.925 0 01-1.272 0l-7.754-7.76a1.734 1.734 0 01-.376-1.894c.27-.652.9-1.073 1.605-1.073h3.202V4.962A3.965 3.965 0 0110 1zm7.01 9.82h-4.85V5.09c0-1.13-.81-2.163-1.934-2.278a2.163 2.163 0 00-2.386 2.15v5.859H2.989l7.01 7.016 7.012-7.016z"></path></g>
    <g class="filled"><path d="M10 1a3.966 3.966 0 013.96 3.962V9.02h3.202c.706 0 1.335.42 1.605 1.073.27.652.122 1.396-.377 1.895l-7.754 7.759a.925.925 0 01-1.272 0l-7.754-7.76a1.734 1.734 0 01-.376-1.894c.27-.652.9-1.073 1.605-1.073h3.202V4.962A3.965 3.965 0 0110 1z"></path></g>
  </svg>`,

  reply: `<svg class="ri-icon ri-icon-reply" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 1a9 9 0 00-9 9c0 1.947.79 3.58 1.935 4.957L.231 17.661A.784.784 0 00.785 19H10a9 9 0 009-9 9 9 0 00-9-9zm0 16.2H6.162c-.994.004-1.907.053-3.045.144l-.076-.188a36.981 36.981 0 002.328-2.087l-1.05-1.263C3.297 12.576 2.8 11.331 2.8 10c0-3.97 3.23-7.2 7.2-7.2s7.2 3.23 7.2 7.2-3.23 7.2-7.2 7.2z"></path></svg>`,

  share: `<svg class="ri-icon ri-icon-share" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M12.8 17.524l6.89-6.887a.9.9 0 000-1.273L12.8 2.477a1.64 1.64 0 00-1.782-.349 1.64 1.64 0 00-1.014 1.518v2.593C4.054 6.728 1.192 12.075 1 17.376a1.353 1.353 0 00.862 1.32 1.35 1.35 0 001.531-.364l.334-.381c1.705-1.944 3.323-3.791 6.277-4.103v2.509c0 .667.398 1.262 1.014 1.518a1.638 1.638 0 001.783-.349v-.002zm-.994-1.548V12h-.9c-3.969 0-6.162 2.1-8.001 4.161.514-4.011 2.823-8.16 8-8.16h.9V4.024L17.784 10l-5.977 5.976z"></path></svg>`,
};

export interface ActionBarOptions {
  isArchived: boolean;
  score: number;
}

/**
 * Renders comment actions bar HTML with votes, reply, share
 */
export function renderActions(comment: any, options: ActionBarOptions): string {
  const { isArchived, score } = options;
  const disabledClass = isArchived ? ' ri-disabled' : '';
  const disabledTitle = isArchived ? ' (post is archived/locked)' : '';

  return `
    <div class="ri-actions">
      <div class="ri-votes">
        <button class="ri-vote-btn ri-upvote${disabledClass}" data-state="idle" title="Upvote${disabledTitle}" ${isArchived ? 'disabled' : ''}>${ACTION_ICONS.upvote}</button>
        <span class="ri-score">${Number(score).toLocaleString()}</span>
        <button class="ri-vote-btn ri-downvote${disabledClass}" data-state="idle" title="Downvote${disabledTitle}" ${isArchived ? 'disabled' : ''}>${ACTION_ICONS.downvote}</button>
      </div>
      <button class="ri-action-btn ri-reply${disabledClass}" title="Reply${disabledTitle}">${ACTION_ICONS.reply}<span>Reply</span></button>
      <button class="ri-action-btn ri-share-btn" title="Share">${ACTION_ICONS.share}<span>Share</span></button>
    </div>
  `;
}

/**
 * Trigger slide animation for vote buttons
 */
export function triggerScoreAnimation(voteBtn: HTMLElement, isUpvote: boolean): void {
  const startY = isUpvote ? -10 : 10;
  const startTime = performance.now();
  const duration = 300;

  // Reset transform
  voteBtn.style.transform = `translateY(${startY}px)`;
  voteBtn.style.transition = 'none';

  const animate = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Spring easing function (approximation)
    const spring = 1 - Math.pow(1 - progress, 3);
    const currentY = startY * (1 - spring);

    voteBtn.style.transform = `translateY(${currentY}px)`;

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      voteBtn.style.transform = '';
      voteBtn.style.transition = '';
    }
  };

  requestAnimationFrame(animate);
}
