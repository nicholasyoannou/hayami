/**
 * Overlay and modal utilities for content script
 */

import { escapeHtml } from '@/utils/markdown';

/**
 * Creates the overlay container for the discussion panel
 */
export function createOverlay(): HTMLDivElement {
  // Remove existing overlay if present
  const existing = document.getElementById('reddit-discussion-overlay');
  if (existing) {
    existing.remove();
  }
  
  const overlay = document.createElement('div');
  overlay.id = 'reddit-discussion-overlay';
  // Overlay styles imported from content.css
  
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Removes the overlay if it exists
 */
export function removeOverlay(): void {
  const overlay = document.getElementById('reddit-discussion-overlay');
  if (overlay) {
    overlay.remove();
  }
}

/**
 * Creates an auth prompt overlay
 */
export function showAuthPrompt(): void {
  const overlay = createOverlay();
  overlay.innerHTML = `
    <div class="reddit-discussion-panel">
      <div class="panel-header">
        <h3>📍 r/anime Discussion</h3>
        <button class="close-btn" id="reddit-close-btn">✕</button>
      </div>
      <div class="panel-content">
        <div class="auth-prompt">
          <p>🔒 Please login with Reddit to view episode discussions</p>
          <button class="reddit-login-btn" id="reddit-login-btn">Login with Reddit</button>
        </div>
      </div>
    </div>
  `;
  
  const closeBtn = overlay.querySelector('#reddit-close-btn');
  closeBtn?.addEventListener('click', () => overlay.remove());
  
  const loginBtn = overlay.querySelector('#reddit-login-btn');
  loginBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openPopup' });
  });
}
