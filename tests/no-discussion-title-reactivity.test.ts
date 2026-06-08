/**
 * Regression test for the SPA "stale no-discussion title" bug.
 *
 * InlineDiscussion.vue renders `No discussion thread found for: <title>` where
 * <title> comes from the inline host element's `data-no-discussion-title`
 * attribute. On a Crunchyroll SPA the content script rewrites that attribute on
 * every episode navigation (selection-ui.ts / discussion-manager.ts) while the
 * host element itself is reused.
 *
 * The bug: `noDiscussionDetailTitle` was a computed() that read
 * `host.dataset.noDiscussionTitle` directly. DOM dataset reads are NOT tracked
 * by Vue reactivity, so the computed cached the first not-found episode's title
 * ("Episode 61") and never recomputed for 62, 63, ... — even though a
 * MutationObserver was firing on the dataset change.
 *
 * The fix captures the title into a ref that the MutationObserver callback
 * refreshes, so the computed depends on tracked state. These tests pin that
 * contract: a dataset-backed computed goes stale; a ref-backed one stays live.
 */
import { describe, it, expect } from 'vitest';
import { ref, computed } from 'vue';

// Minimal stand-in for the inline host element: a stable object whose `dataset`
// the content script mutates in place across SPA navigations.
type FakeHost = { dataset: Record<string, string | undefined> };

function makeHost(title: string): FakeHost {
  return { dataset: { noDiscussion: 'true', noDiscussionTitle: title } };
}

describe('no-discussion title reactivity', () => {
  it('reproduces the bug: a computed reading host.dataset.* caches the first title', () => {
    const host = makeHost('Attack on Titan - Episode 61');
    const hostRef = ref<FakeHost | null>(host);

    // The OLD wiring: read the dataset directly inside the computed.
    const buggyTitle = computed(
      () => hostRef.value?.dataset?.noDiscussionTitle || 'No discussion thread found',
    );

    expect(buggyTitle.value).toBe('Attack on Titan - Episode 61');

    // SPA navigates to the next not-found episode: the content script rewrites
    // the dataset on the SAME host element (hostRef itself does not change).
    host.dataset.noDiscussionTitle = 'Attack on Titan - Episode 62';

    // Bug: the computed never recomputes because dataset reads are untracked.
    expect(buggyTitle.value).toBe('Attack on Titan - Episode 61');
  });

  it('fix: a ref refreshed by the dataset observer keeps the title live', () => {
    const host = makeHost('Attack on Titan - Episode 61');
    const hostRef = ref<FakeHost | null>(host);
    const propsTitle = ref<string>('');

    // The NEW wiring: a ref holds the title, refreshed whenever the observer
    // callback fires; the computed depends on that tracked ref.
    const hostTitle = ref<string | null>(null);
    const syncFromHost = () => {
      hostTitle.value = hostRef.value?.dataset?.noDiscussionTitle || null;
    };
    const fixedTitle = computed(
      () => hostTitle.value || propsTitle.value || 'No discussion thread found',
    );

    syncFromHost(); // onMounted + first observer fire
    expect(fixedTitle.value).toBe('Attack on Titan - Episode 61');

    // Episode 62: dataset rewritten, observer fires -> ref refreshed.
    host.dataset.noDiscussionTitle = 'Attack on Titan - Episode 62';
    syncFromHost();
    expect(fixedTitle.value).toBe('Attack on Titan - Episode 62');

    // Episode 63: same again.
    host.dataset.noDiscussionTitle = 'Attack on Titan - Episode 63';
    syncFromHost();
    expect(fixedTitle.value).toBe('Attack on Titan - Episode 63');
  });

  it('fix: clearing the host title falls back to the discussion prop title', () => {
    const hostRef = ref<FakeHost | null>(makeHost('Attack on Titan - Episode 61'));
    const propsTitle = ref<string>('Some Resolved Thread');

    const hostTitle = ref<string | null>(null);
    const syncFromHost = () => {
      hostTitle.value = hostRef.value?.dataset?.noDiscussionTitle || null;
    };
    const fixedTitle = computed(
      () => hostTitle.value || propsTitle.value || 'No discussion thread found',
    );

    syncFromHost();
    expect(fixedTitle.value).toBe('Attack on Titan - Episode 61');

    // A thread resolves: clearNoDiscussionFlag() clears the ref.
    hostTitle.value = null;
    expect(fixedTitle.value).toBe('Some Resolved Thread');
  });
});
