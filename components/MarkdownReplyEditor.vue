<script setup lang="ts">
import { ref, onMounted } from 'vue';

const props = defineProps<{
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  submit: [text: string];
  cancel: [];
}>();

const editorRef = ref<HTMLDivElement>();
const isSubmitting = ref(false);

function applyFormat(command: string, value?: string) {
  if (!editorRef.value) return;
  editorRef.value.focus();
  document.execCommand(command, false, value);
}

function handleBold() {
  applyFormat('bold');
}

function handleItalic() {
  applyFormat('italic');
}

function handleStrikethrough() {
  applyFormat('strikeThrough');
}

function handleLink() {
  const url = prompt('Enter URL:');
  if (url) {
    applyFormat('createLink', url);
  }
}

function handleBlockquote() {
  applyFormat('formatBlock', 'blockquote');
}

function handleCode() {
  // Wrap selection in <code> tag
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const code = document.createElement('code');
  code.appendChild(range.extractContents());
  range.insertNode(code);
  selection.removeAllRanges();
  selection.addRange(range);
}

function htmlToMarkdown(html: string): string {
  // Create temporary element to parse HTML
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  // Process the DOM tree recursively
  function processNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }
    
    const el = node as HTMLElement;
    const tagName = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map(processNode).join('');
    
    switch (tagName) {
      case 'strong':
      case 'b':
        return `**${children}**`;
      case 'em':
      case 'i':
        return `*${children}*`;
      case 'del':
      case 's':
      case 'strike':
        return `~~${children}~~`;
      case 'code':
        return `\`${children}\``;
      case 'a':
        const href = el.getAttribute('href') || '';
        return `[${children}](${href})`;
      case 'blockquote':
        return `> ${children}`;
      case 'br':
        return '\n';
      case 'p':
        return `${children}\n\n`;
      case 'div':
        return `${children}\n`;
      default:
        return children;
    }
  }
  
  return processNode(temp).trim();
}

function handleSubmit() {
  if (!editorRef.value) return;
  
  const html = editorRef.value.innerHTML;
  const markdown = htmlToMarkdown(html);
  const trimmed = markdown.trim();
  
  if (!trimmed) {
    alert('Reply cannot be empty');
    return;
  }
  
  isSubmitting.value = true;
  emit('submit', trimmed);
}

function handleCancel() {
  emit('cancel');
}

onMounted(() => {
  if (editorRef.value && props.placeholder) {
    editorRef.value.dataset.placeholder = props.placeholder;
  }
});

// Expose method to reset submitting state (in case of error)
defineExpose({
  resetSubmitting: () => {
    isSubmitting.value = false;
  }
});
</script>

<template>
  <div class="ri-reply-box ri-visual-editor">
    <div class="ri-markdown-toolbar">
      <button 
        type="button" 
        @click="handleBold" 
        title="Bold"
        class="ri-toolbar-btn"
        :disabled="disabled || isSubmitting"
      >
        <strong>B</strong>
      </button>
      <button 
        type="button" 
        @click="handleItalic" 
        title="Italic"
        class="ri-toolbar-btn"
        :disabled="disabled || isSubmitting"
      >
        <em>I</em>
      </button>
      <button 
        type="button" 
        @click="handleStrikethrough" 
        title="Strikethrough"
        class="ri-toolbar-btn"
        :disabled="disabled || isSubmitting"
      >
        <s>S</s>
      </button>
      <span class="ri-toolbar-divider">|</span>
      <button 
        type="button" 
        @click="handleLink" 
        title="Link"
        class="ri-toolbar-btn"
        :disabled="disabled || isSubmitting"
      >
        🔗
      </button>
      <button 
        type="button" 
        @click="handleBlockquote" 
        title="Quote"
        class="ri-toolbar-btn"
        :disabled="disabled || isSubmitting"
      >
        "
      </button>
      <button 
        type="button" 
        @click="handleCode" 
        title="Code"
        class="ri-toolbar-btn"
        :disabled="disabled || isSubmitting"
      >
        &lt;&gt;
      </button>
    </div>
    <div 
      ref="editorRef"
      class="ri-visual-content"
      contenteditable="true"
      :data-placeholder="placeholder || 'Write your reply...'"
    ></div>
    <div class="ri-reply-actions">
      <button 
        type="button"
        @click="handleSubmit" 
        class="ri-reply-submit"
        :disabled="disabled || isSubmitting"
      >
        {{ isSubmitting ? 'Submitting...' : 'Submit' }}
      </button>
      <button 
        type="button"
        @click="handleCancel" 
        class="ri-reply-cancel"
        :disabled="isSubmitting"
      >
        Cancel
      </button>
    </div>
  </div>
</template>

<style scoped>
.ri-markdown-toolbar {
  display: flex;
  gap: 4px;
  padding: 8px;
  background: #1a1a1b;
  border: 1px solid #343536;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
}

.ri-toolbar-btn {
  padding: 4px 8px;
  background: #272729;
  border: 1px solid #3a3a3c;
  border-radius: 3px;
  cursor: pointer;
  font-size: 14px;
  min-width: 28px;
  height: 28px;
  color: #d7dadc;
}

.ri-toolbar-btn:hover:not(:disabled) {
  background: #3a3a3c;
}

.ri-toolbar-btn:active:not(:disabled) {
  background: #4a4a4c;
}

.ri-toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ri-toolbar-divider {
  color: #3a3a3c;
  padding: 0 4px;
  display: flex;
  align-items: center;
}

.ri-visual-content {
  min-height: 160px;
  padding: 12px;
  border: 1px solid #343536;
  border-radius: 0 0 4px 4px;
  background: #1a1a1b;
  color: #d7dadc;
  outline: none;
  overflow: auto;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.6;
}

.ri-visual-content:empty:before {
  content: attr(data-placeholder);
  color: #818384;
  pointer-events: none;
}

.ri-visual-content strong,
.ri-visual-content b {
  font-weight: bold;
}

.ri-visual-content em,
.ri-visual-content i {
  font-style: italic;
}

.ri-visual-content code {
  background: #272729;
  padding: 2px 4px;
  border-radius: 3px;
  font-family: "Courier New", monospace;
  font-size: 0.9em;
}

.ri-visual-content blockquote {
  border-left: 3px solid #818384;
  padding-left: 12px;
  margin-left: 0;
  color: #818384;
  font-style: italic;
}

.ri-visual-content a {
  color: #5ba8ff;
  text-decoration: underline;
}

.ri-visual-content a:hover {
  color: #7bb9ff;
}
</style>
