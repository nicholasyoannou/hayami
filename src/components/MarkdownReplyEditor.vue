<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { toast } from 'vue-sonner';

const props = defineProps<{
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  submit: [text: string];
  cancel: [];
}>();

type EditorMode = 'richtext' | 'markdown';

const editorMode = ref<EditorMode>('richtext');
const richTextRef = ref<HTMLDivElement>();
const markdownRef = ref<HTMLTextAreaElement>();
const isSubmitting = ref(false);

// Toolbar active states (when selection is inside these tags)
const isBoldActive = ref(false);
const isItalicActive = ref(false);
const isStrikeActive = ref(false);
const isCodeActive = ref(false);
const isQuoteActive = ref(false);

// Link tooltip state
const showLinkTooltip = ref(false);
const linkTooltipText = ref('');
const tooltipLeft = ref(0);
const tooltipTop = ref(0);

// Store content when switching modes
let richTextContent = '';
let markdownContent = '';

// Watch mode changes to sync content
watch(editorMode, (newMode, oldMode) => {
  if (oldMode === 'richtext' && richTextRef.value) {
    markdownContent = htmlToMarkdown(richTextRef.value.innerHTML);
    if (markdownRef.value) {
      markdownRef.value.value = markdownContent;
    }
  } else if (oldMode === 'markdown' && markdownRef.value) {
    // Convert markdown newlines to <br> so line breaks are preserved visually
    richTextContent = markdownRef.value.value;
    const escaped = richTextContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const withBreaks = escaped.replace(/\n/g, '<br>');
    if (richTextRef.value) {
      richTextRef.value.innerHTML = withBreaks;
    }
  }
});

function switchMode() {
  editorMode.value = editorMode.value === 'richtext' ? 'markdown' : 'richtext';
}

// Rich Text Editor functions - insert placeholder if no selection
function insertRichText(tagName: string, placeholder: string) {
  if (!richTextRef.value) return;
  
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  
  const range = selection.getRangeAt(0);
  const selectedText = range.toString();
  
  const element = document.createElement(tagName);
  
  if (selectedText) {
    // Wrap selected text
    element.appendChild(range.extractContents());
    range.insertNode(element);
  } else {
    // Insert placeholder and select it
    const textNode = document.createTextNode(placeholder);
    element.appendChild(textNode);
    range.insertNode(element);
    
    // Select the placeholder text
    const newRange = document.createRange();
    newRange.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(newRange);
  }
  
  richTextRef.value.focus();
}

function handleBold() {
  if (editorMode.value === 'richtext') {
    insertRichText('strong', 'bold text');
  } else {
    insertMarkdown('**', '**', 'bold text');
  }
}

function handleItalic() {
  if (editorMode.value === 'richtext') {
    insertRichText('em', 'italic text');
  } else {
    insertMarkdown('*', '*', 'italic text');
  }
}

function handleStrikethrough() {
  if (editorMode.value === 'richtext') {
    insertRichText('del', 'strikethrough text');
  } else {
    insertMarkdown('~~', '~~', 'strikethrough text');
  }
}

function handleLink() {
  if (editorMode.value === 'richtext') {
    if (!richTextRef.value) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const url = prompt('Enter URL:', 'https://');
    if (!url) {
      return; // cancelled
    }

    const range = selection.getRangeAt(0);
    const selectedText = range.toString();

    const a = document.createElement('a');
    a.href = url;

    if (selectedText) {
      a.appendChild(range.extractContents());
      range.insertNode(a);
    } else {
      const textNode = document.createTextNode('linked text');
      a.appendChild(textNode);
      range.insertNode(a);

      const newRange = document.createRange();
      newRange.selectNodeContents(a);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }

    richTextRef.value.focus();
  } else {
    const textarea = markdownRef.value;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    const linkText = selectedText || 'linked text';
    
    const markdown = `[${linkText}](https://)`;
    const newText = textarea.value.substring(0, start) + 
                    markdown +
                    textarea.value.substring(end);
    
    textarea.value = newText;
    
    // Position cursor inside the URL part
    const urlStart = start + linkText.length + 3; // after ](
    textarea.focus();
    textarea.setSelectionRange(urlStart, urlStart + 8); // select "https://"
  }
}

function handleBlockquote() {
  if (editorMode.value === 'richtext') {
    insertRichText('blockquote', 'quoted text');
  } else {
    const textarea = markdownRef.value;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    
    // Find start of current line
    let lineStart = start;
    while (lineStart > 0 && textarea.value[lineStart - 1] !== '\n') {
      lineStart--;
    }
    
    const textToInsert = selectedText || 'quoted text';
    const prefix = lineStart === start ? '> ' : '';
    
    const newText = textarea.value.substring(0, lineStart) + 
                    prefix +
                    textarea.value.substring(lineStart, start) +
                    textToInsert +
                    textarea.value.substring(end);
    
    textarea.value = newText;
    
    const newCursorPos = lineStart + prefix.length + (start - lineStart) + textToInsert.length;
    textarea.focus();
    textarea.setSelectionRange(newCursorPos, newCursorPos);
  }
}

function handleCode() {
  if (editorMode.value === 'richtext') {
    insertRichText('code', 'code');
  } else {
    insertMarkdown('`', '`', 'code');
  }
}

function handleSpoiler() {
  if (editorMode.value === 'richtext') {
    if (!richTextRef.value) return;
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString();
    
    const span = document.createElement('span');
    span.className = 'spoiler-input';
  span.style.background = '#333';
  // Keep text visible while author is typing
  span.style.color = '#d7dadc';
    span.style.padding = '0 4px';
    span.style.borderRadius = '3px';
    // create visual breathing room without inserting actual spaces
    span.style.margin = '0 0.2em';
    
    if (selectedText) {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } else {
      const textNode = document.createTextNode('spoiler text');
      span.appendChild(textNode);
      range.insertNode(span);

      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }
    
    richTextRef.value.focus();
  } else {
    insertMarkdown('>!', '!<', 'spoiler text');
  }
}

// Markdown mode insertion helper
function insertMarkdown(prefix: string, suffix: string, placeholder: string) {
  const textarea = markdownRef.value;
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.substring(start, end);
  const textToInsert = selectedText || placeholder;
  
  const newText = textarea.value.substring(0, start) + 
                  prefix + textToInsert + suffix +
                  textarea.value.substring(end);
  
  textarea.value = newText;
  
  // Set cursor position after insertion
  const newCursorPos = selectedText 
    ? start + prefix.length + selectedText.length + suffix.length
    : start + prefix.length + placeholder.length;
  
  textarea.focus();
  textarea.setSelectionRange(newCursorPos, newCursorPos);
}

// Convert HTML to Markdown when switching modes or submitting
function htmlToMarkdown(html: string): string {
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
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
      case 'span':
        if (el.className.includes('spoiler')) {
          return `>!${children}!<`;
        }
        return children;
      case 'br':
        return '\n';
      case 'p':
      case 'div':
        return `${children}\n`;
      default:
        return children;
    }
  }
  
  return processNode(temp).trim();
}

function handleSubmit() {
  let content = '';
  
  if (editorMode.value === 'richtext' && richTextRef.value) {
    content = htmlToMarkdown(richTextRef.value.innerHTML);
  } else if (editorMode.value === 'markdown' && markdownRef.value) {
    content = markdownRef.value.value;
  }
  
  const trimmed = content.trim();
  
  if (!trimmed) {
    toast.error('Reply cannot be empty');
    return;
  }
  
  isSubmitting.value = true;
  emit('submit', trimmed);
}

function handleCancel() {
  emit('cancel');
}

// Handle Enter key in rich text mode - insert plain text line
function handleRichTextKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);

    // Determine if we're inside a formatting element; if so, break out
    const formattingTags = new Set(['STRONG','EM','DEL','CODE','SPAN']);
    let container: Node | null = range.startContainer;
    let formattingAncestor: HTMLElement | null = null;
    while (container && container !== richTextRef.value) {
      if (container instanceof HTMLElement && formattingTags.has(container.tagName) && !container.classList.contains('spoiler-input')) {
        formattingAncestor = container;
      }
      container = container.parentNode;
    }

    if (formattingAncestor) {
      // Move range after formatting ancestor so new line is plain
      const after = document.createRange();
      after.setStartAfter(formattingAncestor);
      after.setEndAfter(formattingAncestor);
      selection.removeAllRanges();
      selection.addRange(after);
    }

    // Insert single <br> and a zero-width space text node so caret sits on new blank line
    const br = document.createElement('br');
    const zw = document.createTextNode('\u200B');
    const currentRange = selection.getRangeAt(0);
    currentRange.insertNode(br);
    // Move cursor after br
    const post = document.createRange();
    post.setStartAfter(br);
    post.collapse(true);
    // Insert placeholder text node to ensure caret visible
    post.insertNode(zw);
    // Set caret inside the empty text node
    const caret = document.createRange();
    caret.setStart(zw, 1);
    caret.setEnd(zw, 1);
    selection.removeAllRanges();
    selection.addRange(caret);
  }
}

// Expose method to reset submitting state (in case of error)
defineExpose({
  resetSubmitting: () => {
    isSubmitting.value = false;
  }
});

// Determine active formatting when selection changes inside the editor
function updateActiveFormatting() {
  if (!richTextRef.value) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const container = sel.anchorNode as Node | null;
  let el: Node | null = container;
  let bold = false, italic = false, strike = false, code = false, quote = false;
  while (el && el !== richTextRef.value) {
    if (el instanceof HTMLElement) {
      const tag = el.tagName;
      if (tag === 'STRONG' || tag === 'B') bold = true;
      if (tag === 'EM' || tag === 'I') italic = true;
      if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') strike = true;
      if (tag === 'CODE') code = true;
      if (tag === 'BLOCKQUOTE') quote = true;
    }
    el = el.parentNode;
  }
  isBoldActive.value = bold;
  isItalicActive.value = italic;
  isStrikeActive.value = strike;
  isCodeActive.value = code;
  isQuoteActive.value = quote;
}

function onSelectionChange() {
  if (editorMode.value !== 'richtext') return;
  updateActiveFormatting();
}

onMounted(() => {
  document.addEventListener('selectionchange', onSelectionChange);
});

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', onSelectionChange);
});

// Link tooltip handlers
function handleRichMouseOver(e: MouseEvent) {
  if (!richTextRef.value) return;
  const target = (e.target as HTMLElement).closest('a');
  if (target && richTextRef.value.contains(target)) {
    linkTooltipText.value = target.getAttribute('href') || '';
    if (linkTooltipText.value) {
      showLinkTooltip.value = true;
    }
  }
}

function handleRichMouseMove(e: MouseEvent) {
  if (!showLinkTooltip.value) return;
  const parentRect = (richTextRef.value as HTMLDivElement).getBoundingClientRect();
  // Position slightly above the cursor within the editor box
  tooltipLeft.value = e.clientX - parentRect.left + 12; // 12px offset
  tooltipTop.value = e.clientY - parentRect.top + 16; // 16px below cursor
}

function handleRichMouseOut(e: MouseEvent) {
  const rel = e.relatedTarget as HTMLElement | null;
  if (!rel || !(rel.closest && rel.closest('.ri-visual-content a'))) {
    showLinkTooltip.value = false;
    linkTooltipText.value = '';
  }
}
</script>

<template>
  <div class="ri-reply-box">
    
    <div v-show="editorMode === 'richtext'" class="ri-richtext-editor">
      <div class="ri-markdown-toolbar">
        <button
          type="button"
          @click="handleBold"
          title="Bold"
          :class="['ri-toolbar-btn', { active: isBoldActive }]"
          :disabled="disabled || isSubmitting"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          @click="handleItalic"
          title="Italic"
          :class="['ri-toolbar-btn', { active: isItalicActive }]"
          :disabled="disabled || isSubmitting"
        >
          <em>I</em>
        </button>
        <button
          type="button"
          @click="handleStrikethrough"
          title="Strikethrough"
          :class="['ri-toolbar-btn', { active: isStrikeActive }]"
          :disabled="disabled || isSubmitting"
        >
          <s>S</s>
        </button>
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
          :class="['ri-toolbar-btn', { active: isQuoteActive }]"
          :disabled="disabled || isSubmitting"
        >
          "
        </button>
        <button
          type="button"
          @click="handleCode"
          title="Code"
          :class="['ri-toolbar-btn', { active: isCodeActive }]"
          :disabled="disabled || isSubmitting"
        >
          &lt;&gt;
        </button>
        <button
          type="button"
          @click="handleSpoiler"
          title="Spoiler"
          class="ri-toolbar-btn"
          :disabled="disabled || isSubmitting"
        >
          ⚠️
        </button>
        <div class="ri-toolbar-spacer"></div>
        <button
          type="button"
          class="ri-mode-toggle inline"
          @click="switchMode"
          :disabled="disabled || isSubmitting"
        >
          {{ editorMode === 'richtext' ? 'Switch to Markdown' : 'Switch to Rich Text' }}
        </button>
      </div>
      <div
        ref="richTextRef"
        class="ri-visual-content"
        contenteditable="true"
        :data-placeholder="placeholder || 'Write your reply...'"
        @keydown="handleRichTextKeydown"
        @mouseover="handleRichMouseOver"
        @mousemove="handleRichMouseMove"
        @mouseout="handleRichMouseOut"
      ></div>
      <div
        v-if="showLinkTooltip && linkTooltipText"
        class="ri-link-tooltip"
        :style="{ left: tooltipLeft + 'px', top: tooltipTop + 'px' }"
      >
        {{ linkTooltipText }}
      </div>
    </div>
    
    <div v-show="editorMode === 'markdown'" class="ri-markdown-mode">
      <textarea
        ref="markdownRef"
        class="ri-markdown-textarea"
        :placeholder="placeholder || 'Write your reply in markdown...'"
        :disabled="disabled || isSubmitting"
      ></textarea>
    </div>
    
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
.ri-mode-toggle {
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: #5ba8ff;
  text-decoration: none;
  font-weight: 400;
}

.ri-mode-toggle:hover:not(:disabled) {
  color: #7bb9ff;
  text-decoration: underline;
}

.ri-mode-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ri-markdown-toolbar {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  align-items: center;
}

.ri-toolbar-spacer { flex: 1 1 auto; }

.ri-toolbar-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  color: #d7dadc;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: background 0.15s, color 0.15s;
}

.ri-toolbar-btn:hover:not(:disabled) {
  background: #2a2a2c;
}

.ri-toolbar-btn.active {
  background: #3a3a3c;
  color: #ffffff;
}

.ri-toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ri-toolbar-divider {
  width: 1px;
  background: #3a3a3c;
  margin: 0 4px;
}

.ri-visual-content {
  min-height: 120px;
  max-height: 320px;
  padding: 10px 14px 10px 14px;
  border: none;
  background: #111213;
  color: #d7dadc;
  outline: none;
  overflow: auto;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
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
  background: #1f2224;
  padding: 3px 6px;
  border-radius: 8px;
  border: 1px solid #2e3236;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.92em;
  color: #e7e9ea;
}

.ri-visual-content blockquote {
  border-left: 6px solid #2f3336;
  padding-left: 12px;
  margin: 6px 0;
  color: #d7dadc;
  font-style: normal;
}

.ri-visual-content a {
  color: #5ba8ff;
  text-decoration: underline;
  position: relative;
}

.ri-visual-content a:hover {
  color: #7bb9ff;
}

/* Clear formatting on new lines */
.ri-visual-content div {
  margin: 0;
  padding: 0;
}

/* Spoiler in editor: visible text, allow wrapping and line breaks */
.ri-visual-content .spoiler-input {
  background: #26282a;
  color: #d7dadc;
  border-radius: 6px;
  padding: 0 6px;
  white-space: pre-wrap; /* allow multi-line */
  border: 1px solid #2e3236;
}

/* Link tooltip (only for hovered anchor) */
.ri-link-tooltip {
  position: absolute;
  background: #000;
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  pointer-events: none;
  z-index: 10;
  max-width: 320px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 2px 6px rgba(0,0,0,0.4);
  border: 1px solid #333;
}

.ri-markdown-textarea {
  width: 100%;
  min-height: 120px;
  max-height: 320px;
  padding: 10px 14px;
  border: none;
  background: #111213;
  color: #d7dadc;
  outline: none;
  resize: vertical;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  box-sizing: border-box;
  border-radius: 0;
}

.ri-markdown-textarea::placeholder {
  color: #818384;
}

.ri-markdown-textarea:focus {
  border-color: #4a4a4c;
}

.ri-markdown-textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ri-reply-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 8px 10px 12px 10px;
  background: transparent;
}

.ri-reply-submit {
  padding: 8px 22px;
  background: #ff4500;
  border: none;
  border-radius: 24px;
  color: white;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
}

.ri-reply-submit:hover:not(:disabled) {
  background: #ff5722;
}

.ri-reply-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ri-reply-cancel {
  padding: 8px 22px;
  background: transparent;
  border: none;
  border-radius: 24px;
  color: #d7dadc;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
}

.ri-reply-cancel:hover:not(:disabled) {
  background: #272729;
}

.ri-reply-cancel:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Container look: smaller, rounder, no inner lines */
.ri-reply-box {
  border-radius: 18px;
  border: 1px solid #2f3336;
  background: #0c0d0e;
  overflow: hidden;
}
</style>
