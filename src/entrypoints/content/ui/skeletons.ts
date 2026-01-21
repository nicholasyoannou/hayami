/**
 * Skeleton loading utilities
 * Provides loading state UI for comments sections
 */

/**
 * Generates HTML for skeleton comment loaders
 */
export function generateSkeletonHtml(count: number = 6): string {
  const skeletonItem = `<div class="ri-skel"><div class="sk-ava"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w80"></div><div class="sk-line w40"></div></div></div>`;
  return Array.from({ length: count }, () => skeletonItem).join('');
}

/**
 * Shows skeleton loading in the comments section area
 */
export function showCommentsSkeletonLoading(): HTMLElement | null {
  // Remove existing skeleton if present
  const existing = document.getElementById('ri-loading-skeleton');
  if (existing) existing.remove();

  const layout = document.querySelector('.erc-watch-episode-layout');
  const wrapper = layout?.querySelectorAll('[class^="content-wrapper"]')[1] as HTMLElement | null;
  if (!wrapper) {
    return null; // Can't show inline skeleton if wrapper not found
  }

  const container = document.createElement('section');
  container.id = 'ri-loading-skeleton';
  container.innerHTML = `
    <div class="ri-toolbar" style="opacity:0.5;">
      <div class="ri-sort">Sort by: <select class="ri-sort-select" disabled><option>Best</option></select></div>
      <div class="ri-search"><input type="search" placeholder="Search comments" class="ri-search-input" disabled/></div>
    </div>
    <div class="ri-header" style="opacity:0.5;">
      <h3 class="ri-title" style="background:linear-gradient(90deg, #2c2c2c 25%, #1a1a1a 50%, #2c2c2c 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;height:20px;border-radius:4px;"></h3>
    </div>
    <div class="ri-meta" style="opacity:0.5;height:16px;background:linear-gradient(90deg, #2c2c2c 25%, #1a1a1a 50%, #2c2c2c 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:4px;margin:6px 0 12px;width:200px;"></div>
    <div class="ri-comments"></div>
  `;
  
  const commentsRoot = container.querySelector('.ri-comments') as HTMLElement;
  // Show skeleton comments
  commentsRoot.innerHTML = generateSkeletonHtml(6);

  wrapper.appendChild(container);
  return container;
}

/**
 * Removes skeleton loading from comments section
 */
export function removeCommentsSkeletonLoading(): void {
  const skeleton = document.getElementById('ri-loading-skeleton');
  if (skeleton) skeleton.remove();
}

/**
 * Shows skeletons inside a comments root element
 */
export function showSkeletonsInElement(element: HTMLElement, count: number = 8): void {
  element.innerHTML = generateSkeletonHtml(count);
}
