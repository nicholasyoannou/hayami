<script setup lang="ts">
defineOptions({ name: 'AniListReplyEditor' });

import { ref, inject, type Ref } from 'vue';
import { toast } from 'vue-sonner';
import type { AniListThreadComment } from '@/entrypoints/content/types/data';
import { saveThreadComment } from '@/utils/anilist/mutations';

const props = withDefaults(defineProps<{
  mode: 'top-level' | 'reply';
  parentCommentId?: number | string;
  placeholder?: string;
  autofocus?: boolean;
}>(), {
  autofocus: false,
});

const emit = defineEmits<{
  (e: 'submitted', newComment: AniListThreadComment): void;
  (e: 'cancel'): void;
}>();

const threadId = inject<Ref<number | string | undefined>>('anilistThreadId');
const requestAuth = inject<() => Promise<boolean>>('anilistRequestAuth', async () => true);

const text = ref('');
const submitting = ref(false);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

function setTextareaRef(el: any) {
  textareaRef.value = (el as HTMLTextAreaElement) ?? null;
  if (props.autofocus && textareaRef.value) {
    queueMicrotask(() => textareaRef.value?.focus());
  }
}

async function handleSubmit() {
  const body = text.value.trim();
  if (!body || submitting.value) return;

  if (!threadId?.value) {
    toast.error('Cannot post comment', { description: 'Thread is not available.' });
    return;
  }

  const authed = await requestAuth();
  if (!authed) return;

  submitting.value = true;
  try {
    const result = await saveThreadComment({
      threadId: threadId.value,
      parentCommentId: props.parentCommentId,
      comment: body,
    });

    if (!result.ok || !result.comment) {
      toast.error('Failed to post comment', {
        description: result.error || 'AniList rejected the request.',
      });
      return;
    }

    emit('submitted', result.comment);
    text.value = '';
  } finally {
    submitting.value = false;
  }
}

function handleCancel() {
  text.value = '';
  emit('cancel');
}

function handleKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    handleSubmit();
  }
}
</script>

<template>
  <div
    class="ri-anilist-reply-editor"
    :class="{ 'ri-anilist-reply-editor-inline': mode === 'reply' }"
  >
    <textarea
      :ref="setTextareaRef"
      v-model="text"
      class="ri-anilist-reply-editor-textarea"
      :placeholder="placeholder || (mode === 'reply' ? 'Write a reply…' : 'Write a comment…')"
      :disabled="submitting"
      rows="3"
      @keydown="handleKeydown"
    ></textarea>
    <div class="ri-anilist-reply-editor-actions">
      <button
        v-if="mode === 'reply'"
        type="button"
        class="ri-anilist-reply-editor-button ri-anilist-reply-editor-button-cancel"
        :disabled="submitting"
        @click="handleCancel"
      >
        Cancel
      </button>
      <button
        type="button"
        class="ri-anilist-reply-editor-button ri-anilist-reply-editor-button-submit"
        :disabled="submitting || !text.trim()"
        @click="handleSubmit"
      >
        {{ submitting ? 'Posting…' : (mode === 'reply' ? 'Reply' : 'Post comment') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.ri-anilist-reply-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--ri-bg-even, #151f2e);
  border-radius: var(--ri-radius, 4px);
  padding: 12px;
}

.ri-anilist-reply-editor-inline {
  margin: 8px 0 12px;
}

.ri-anilist-reply-editor-textarea {
  width: 100%;
  min-height: 80px;
  resize: vertical;
  background: var(--ri-bg-base, #0b1622);
  border: 1px solid rgba(159, 173, 189, 0.15);
  border-radius: var(--ri-radius, 4px);
  color: var(--ri-text, #9fadbd);
  padding: 8px 10px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  box-sizing: border-box;
}

.ri-anilist-reply-editor-textarea:focus {
  outline: none;
  border-color: var(--ri-link, #3db4f2);
}

.ri-anilist-reply-editor-textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ri-anilist-reply-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ri-anilist-reply-editor-button {
  border: none;
  border-radius: var(--ri-radius, 4px);
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}

.ri-anilist-reply-editor-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ri-anilist-reply-editor-button-cancel {
  background: transparent;
  color: var(--ri-meta, #8596a5);
}

.ri-anilist-reply-editor-button-cancel:hover:not(:disabled) {
  color: var(--ri-text, #9fadbd);
}

.ri-anilist-reply-editor-button-submit {
  background: var(--ri-link, #3db4f2);
  color: #fff;
}

.ri-anilist-reply-editor-button-submit:hover:not(:disabled) {
  filter: brightness(1.1);
}
</style>
