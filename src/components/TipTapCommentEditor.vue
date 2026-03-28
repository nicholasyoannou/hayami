<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import CodeBlock from '@tiptap/extension-code-block';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import Link from '@tiptap/extension-link';
import Superscript from '@tiptap/extension-superscript'
import Strike from '@tiptap/extension-strike'
import { Mark, markInputRule, markPasteRule, mergeAttributes } from '@tiptap/core';
import type { CommandProps, RawCommands } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';

const props = defineProps<{
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  submit: [text: string];
  cancel: [];
}>();

const cachedHtml = ref('');

// Custom Spoiler mark (Reddit uses >! !<)
const Spoiler = Mark.create({
  name: 'spoiler',

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'spoiler', // or any class for styling
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span.spoiler', // or tag: 'span[style*="background-color"]' if you want to match old rendering
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // Render as a span so it doesn't serialize as inline code
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addInputRules() {
    return [
      markInputRule({
        find: />\!(.*?)\!</g, // matches >!text!< with global flag
        type: this.type,
        getAttributes: match => ({ text: match[1] }),
      }),
    ]
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: />\!(.*?)\!</g, // matches >!text!< with global flag
        type: this.type,
      }),
    ]
  },

  addCommands(): Partial<RawCommands> {
    return {
      toggleSpoiler:
        () =>
        ({ commands }: CommandProps) => {
          return commands.toggleMark(this.name)
        },

      setSpoiler:
        () =>
        ({ commands }: CommandProps) => {
          return commands.setMark(this.name)
        },

      unsetSpoiler:
        () =>
        ({ commands }: CommandProps) => {
          return commands.unsetMark(this.name)
        },
    } as Partial<RawCommands>
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    spoiler: {
      toggleSpoiler: () => ReturnType
      setSpoiler: () => ReturnType
      unsetSpoiler: () => ReturnType
    }
  }
}

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      link: false,
      strike: false,
      codeBlock: false,
    }),
    CodeBlock,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
    }),
    Placeholder.configure({
      placeholder: props.placeholder || 'Write a comment...',
      emptyEditorClass: 'is-editor-empty',
    }),
    BubbleMenu.configure({
      // Show popover when there's a selection or active link
      shouldShow: ({ editor }) => {
        return editor.isActive('link') || !editor.state.selection.empty
      },
    }),
    Superscript.configure({
      HTMLAttributes: {
        class: 'superscript',
      },
    }),
    Strike.configure({
      HTMLAttributes: {
        class: 'strike',
      },
    }),
    Spoiler,
    Markdown
  ],

  content: '',
  autofocus: false,
  editable: !props.disabled,
  editorProps: {
    attributes: {
      class: 'tiptap prose prose-invert max-w-none focus:outline-none',
    },
  },
  onUpdate: ({ editor }) => {
    cachedHtml.value = editor.getHTML();
    editor.view.updateState(editor.view.state);
  },
});

watch(() => props.disabled, (val) => {
  editor.value?.setEditable(!val);
});

onBeforeUnmount(() => {
  editor.value?.destroy();
});

function htmlToMarkdown(html: string): string {
  const temp = document.createElement('div');
  temp.innerHTML = html;

  const processNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map(processNode).join('');

    switch (tag) {
      case 'span': {
        const cls = el.getAttribute('class') || '';
        if (cls.split(/\s+/).includes('spoiler')) {
          return `>!${children}!<`;
        }
        return children;
      }
      case 'strong':
      case 'b':
        return `**${children}**`;
      case 'em':
      case 'i':
        return `*${children}*`;
      case 'u':
        return `__${children}__`;
      case 's':
      case 'del':
      case 'strike':
        return `~~${children}~~`;
      case 'code':
        return `\`${children}\``;
      case 'pre':
      case 'code-block':
        return `\n\n\`\`\`\n${children}\n\`\`\`\n\n`;
      case 'blockquote':
        return children
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n');
      case 'ul':
        return children;
      case 'ol':
        return children;
      case 'li': {
        const parent = el.parentElement?.tagName.toLowerCase();
        const marker = parent === 'ol' ? '1.' : '-';
        return `${marker} ${children}\n`;
      }
      case 'a': {
        const href = el.getAttribute('href') || '';
        return `[${children}](${href})`;
      }
      case 'br':
        return '\n';
      case 'p':
        return `${children}\n\n`;
      default:
        return children;
    }
  };

  return processNode(temp).replace(/\n{3,}/g, '\n\n').trim();

};

function setLink() {
  if (!editor.value) return;

  const isLinkActive = editor.value.isActive('link');
  const previousUrl = isLinkActive ? editor.value.getAttributes('link').href : '';

  const url = window.prompt('Enter URL (leave empty to remove link):', previousUrl || '');

  // User cancelled
  if (url === null) return;

  // Remove link if empty
  if (url.trim() === '') {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }

  // Set / update link
  editor.value.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
}



function submit() {
  if (!editor.value) return;
  const md = htmlToMarkdown(editor.value.getHTML());
  if (!md) return;
  console.log('Submitted Markdown:', md);

  emit('submit', md);
  editor.value.commands.clearContent();
}


function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    submit();
  }
}

const isReady = computed(() => !!editor.value);

</script>

<template>
  <div class="editor-container">
    <div v-if="editor" class="toolbar">
      <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('bold') }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleBold().run()"
        title="Bold"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path d="M8.21 13c2.106 0 3.412-1.087 3.412-2.823 0-1.306-.984-2.283-2.324-2.386v-.055a2.176 2.176 0 0 0 1.852-2.14c0-1.51-1.162-2.46-3.014-2.46H3.843V13zM5.908 4.674h1.696c.963 0 1.517.451 1.517 1.244 0 .834-.629 1.32-1.73 1.32H5.908V4.673zm0 6.788V8.598h1.73c1.217 0 1.88.492 1.88 1.415 0 .943-.643 1.449-1.832 1.449H5.907z"/>
        </svg>
      </button>

      <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('italic') }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleItalic().run()"
        title="Italic"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path d="M7.991 11.674 9.53 4.455c.123-.595.246-.71 1.347-.807l.11-.52H7.211l-.11.52c1.06.096 1.128.212 1.005.807L6.57 11.674c-.123.595-.246.71-1.346.806l-.11.52h3.774l.11-.52c-1.06-.095-1.129-.211-1.006-.806z"/>
        </svg>
      </button>

      <!-- <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('underline') }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleUnderline().run()"
        title="Underline"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path d="M5.313 3.136h-1.23V9.54c0 2.105 1.47 3.623 3.917 3.623s3.917-1.518 3.917-3.623V3.136h-1.23v6.323c0 1.49-.978 2.57-2.687 2.57s-2.687-1.08-2.687-2.57zM12.5 15h-9v-1h9z"/>
        </svg>
      </button> -->

      <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('strike') }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleStrike().run()"
        title="Strikethrough"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path d="M6.333 5.686c0 .31.083 .581.27 .814H5.166a2.8 2.8 0 0 1-.099-.76c0-1.627 1.436-2.768 3.48-2.768 1.969 0 3.39 1.175 3.445 2.85h-1.23c-.11-1.08-.964-1.743-2.25-1.743-1.23 0-2.18.602-2.18 1.607zm2.194 7.478c-2.153 0-3.589-1.107-3.705-2.81h1.23c.144 1.06 1.129 1.703 2.544 1.703 1.34 0 2.31-.705 2.31-1.675 0-.827-.547-1.374-1.914-1.675L8.046 8.5H1v-1h14v1h-3.504c.468.437.675.994.675 1.697 0 1.826-1.436 2.967-3.644 2.967"/>
        </svg>
      </button>

      <div class="divider" />

      <!-- Heading button (example: toggle H2, or cycle levels – simple version) -->
      <!-- <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('heading', { level: 2 }) }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
        title="Heading 2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path d="M8.5 4.5v7h-1v-7H3.5v-1H13v1H8.5zM3 13h10v1H3v-1z"/>
        </svg>
      </button> -->

      <!-- Superscript button -->
      <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('superscript') }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleSuperscript().run()"
        title="Superscript"
      >
<svg rpl="" fill="currentColor" height="16" icon-name="superscript" viewBox="0 0 20 20" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M8.215 9.992v.086l4.314 6.384a.958.958 0 01-1.247 1.377.955.955 0 01-.345-.318L6.992 11.5h-.086l-3.944 6.021a.955.955 0 01-1.755-.574.957.957 0 01.162-.485l4.314-6.384v-.086L1.388 3.549a.908.908 0 111.517-.997l4 6.174h.086l4-6.174a.909.909 0 111.517.997L8.215 9.992zm10.12-2.807h-1.109l-.54.022.68-.843c.27-.331.471-.593.62-.8.153-.218.28-.453.38-.7a2.11 2.11 0 00.155-.8 1.9 1.9 0 00-.29-1.042 1.965 1.965 0 00-.8-.7 2.4 2.4 0 00-1.14-.25 2.575 2.575 0 00-1.218.282c-.348.183-.637.46-.835.8a2.472 2.472 0 00-.238.712.693.693 0 00.15.578.8.8 0 00.616.281 1.08 1.08 0 00.943-.8.616.616 0 01.235-.253.687.687 0 01.342-.09.611.611 0 01.424.161.532.532 0 01.158.403.988.988 0 01-.1.43c-.079.169-.174.33-.284.48-.117.16-.274.365-.467.6-.119.148-.208.259-.265.334l-1.368 1.701A.622.622 0 0014.87 8.7h3.466a.758.758 0 000-1.515z"></path></svg>
      </button>

      <!-- Spoiler button -->
      <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('spoiler') }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleSpoiler().run()"
        title="Spoiler"
      >
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
  <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755q-.247.248-.517.486z"/>
  <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
  <path d="M3.35 5.47q-.27.24-.518.487A13 13 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12z"/>
</svg>      
</button>

      <!-- <div class="divider" /> -->

      <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('blockquote') }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleBlockquote().run()"
        title="Blockquote"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path d="M2.5 3a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1zm5 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1zm0 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1zm-5 3a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1zm.79-5.373q.168-.117.444-.275L3.524 6q-.183.111-.452.287-.27.176-.51.428a2.4 2.4 0 0 0-.398.562Q2 7.587 2 7.969q0 .54.217.873.217.328.72.328.322 0 .504-.211a.7.7 0 0 0 .188-.463q0-.345-.211-.521-.205-.182-.568-.182h-.282q.036-.305.123-.498a1.4 1.4 0 0 1 .252-.37 2 2 0 0 1 .346-.298zm2.167 0q.17-.117.445-.275L5.692 6q-.183.111-.452.287-.27.176-.51.428a2.4 2.4 0 0 0-.398.562q-.165.31-.164.692 0 .54.217.873.217.328.72.328.322 0 .504-.211a.7.7 0 0 0 .188-.463q0-.345-.211-.521-.205-.182-.568-.182h-.282a1.8 1.8 0 0 1 .118-.492q.087-.194.257-.375a2 2 0 0 1 .346-.3z"/>
        </svg>
      </button>

      <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('code') }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleCode().run()"
        title="Inline Code"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8z"/>
        </svg>
      </button>

      <!-- <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('codeBlock') }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleCodeBlock().run()"
        title="Code Block"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/>
          <path d="M6.854 4.646a.5.5 0 0 1 0 .708L4.207 8l2.647 2.646a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 0 1 .708 0m2.292 0a.5.5 0 0 0 0 .708L11.793 8l-2.647 2.646a.5.5 0 0 0 .708.708l3-3a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708 0"/>
        </svg>
      </button> -->

      <div class="divider" />

      <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('link') }"
        :disabled="props.disabled || editor.state.selection.empty"
        @click="setLink"
        title="Link"
        >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
          <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z"/>
        </svg>
      </button>


      <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('bulletList') }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleBulletList().run()"
        title="Bullet List"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path fill-rule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m-3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2m0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2m0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2"/>
        </svg>
      </button>

      <button
        type="button"
        class="icon-btn"
        :class="{ 'is-active': editor.isActive('orderedList') }"
        :disabled="props.disabled"
        @click="editor.chain().focus().toggleOrderedList().run()"
        title="Numbered List"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path fill-rule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5"/>
          <path d="M1.713 11.865v-.474H2c.217 0 .363-.137.363-.317 0-.185-.158-.31-.361-.31-.223 0-.367.152-.373.31h-.59c.016-.467.373-.787.986-.787.588-.002.954.291.957.703a.595.595 0 0 1-.492.594v.033a.615.615 0 0 1 .569.631c.003.533-.502.8-1.051.8-.656 0-1-.37-1.008-.794h.582c.008.178.186.306.422.309.254 0 .424-.145.422-.35-.002-.195-.155-.348-.414-.348h-.3zm-.004-4.699h-.604v-.035c0-.408.295-.844.958-.844.583 0 .96.326.96.756 0 .389-.257.617-.476.848l-.537.572v.03h1.054V9H1.143v-.395l.957-.99c.138-.142.293-.304.293-.508 0-.18-.147-.32-.342-.32a.33.33 0 0 0-.342.338zM2.564 5h-.635V2.924h-.031l-.598.42v-.567l.629-.443h.635z"/>
        </svg>
      </button>

      <div class="toolbar-spacer" />

      <button
        type="button"
        class="icon-btn"
        :disabled="props.disabled || !editor.can().undo()"
        @click="editor.chain().focus().undo().run()"
        title="Undo"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"/>
          <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466"/>
        </svg>
      </button>

      <button
        type="button"
        class="icon-btn"
        :disabled="props.disabled || !editor.can().redo()"
        @click="editor.chain().focus().redo().run()"
        title="Redo"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
        </svg>
      </button>
    </div>

    <div class="editor-area" :class="{ disabled: props.disabled }">
      <EditorContent
        v-if="isReady"
        :editor="editor"
        @keydown="handleKeydown"
      />
      <div v-else class="loading">Loading editor…</div>
    </div>

    <div class="actions">
      <button type="button" class="action-btn cancel" :disabled="props.disabled" @click="emit('cancel')">
        Cancel
      </button>
      <button type="button" class="action-btn comment" :disabled="props.disabled" @click="submit">
        Comment
      </button>
    </div>
  </div>
</template>

<style scoped>
.editor-container {
  display: flex;
  flex-direction: column;
  background: #0F0F0F;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #FFFFFF33;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 12px;
  background: #0F0F0F;
}

.icon-btn {
  background: none;
  border: none;
  color: #c9d1d9;
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s;
  display: flex;
  align-items: center;
}

.icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.icon-btn.is-active {
  color: #58a6ff;
  background: rgba(88, 166, 255, 0.12);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.divider {
  width: 1px;
  height: 20px;
  background: #30363d;
  margin: 0 6px;
}

.toolbar-spacer {
  flex: 1;
}

/* TipTap editor list styles - these override Tailwind resets */
.editor-container :deep(.tiptap ul) {
  list-style-type: disc;
  margin-left: 1.8em;
  padding-left: 0;
}

.editor-container :deep(.tiptap ol) {
  list-style-type: decimal;
  margin-left: 1.8em;
  padding-left: 0;
}

/* Explicitly set list-style-type on li elements within tiptap to override Tailwind resets */
/* Using !important because injected global styles have same specificity */
.editor-container :deep(.tiptap ul > li) {
  list-style-type: disc !important;
}

.editor-container :deep(.tiptap ol > li) {
  list-style-type: decimal !important;
}

/* Style the list markers for tiptap content */
.editor-container :deep(.tiptap ul > li::marker),
.editor-container :deep(.tiptap ol > li::marker) {
  color: #c9d1d9;
  font-size: 1.1em;
}

.editor-container .editor-area ol {
  list-style-type: decimal;
}

.editor-container .editor-area ul {
  list-style-type: disc;
}

.editor-container .editor-area li {
  margin-bottom: 0.4em;
  padding-left: 0.3em;
}

/* Also set for editor-area in case content is there */
.editor-container .editor-area ul > li {
  list-style-type: disc !important;
}

.editor-container .editor-area ol > li {
  list-style-type: decimal !important;
}

/* Style the list markers for editor-area */
.editor-container .editor-area ul > li::marker,
.editor-container .editor-area ol > li::marker {
  color: #c9d1d9;
  font-size: 1.1em;
}

/* Nested lists */
.editor-container .editor-area ul ul,
.editor-container .editor-area ol ol,
.editor-container .editor-area ul ol,
.editor-container .editor-area ol ul {
  margin: 0.4em 0 0.4em 1.2em;
}

.editor-area {
  min-height: 60px;
  padding: 0px 10px;
  background: #0F0F0F;
  color: #c9d1d9;
}

/* .tiptap lives inside EditorContent (child component), so it must be
   targeted via :deep(...) from a scoped parent selector. */
.editor-area :deep(.tiptap) {
  font-size: 14px;
  line-height: 1.6;
  color: #c9d1d9;
  word-wrap: break-word;
  overflow-wrap: break-word;
  padding: 4px 0 4px 8px;
}

.editor-area.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.editor-area :deep(p.is-editor-empty:first-child::before) {
  color: #8b949e;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

.editor-area :deep(p) {
  margin: 0 0 12px;
}

.editor-area :deep(pre) {
  background: #161b22;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  color: #c9d1d9;
  margin: 12px 0;
}

.editor-area :deep(blockquote) {
  border-left: 3px solid #30363d;
  padding-left: 12px;
  margin: 12px 0;
  color: #8b949e;
}

.editor-area :deep(code) {
  background: #21262d;
  padding: 2px 6px;
  border-radius: 4px;
  color: #79c0ff;
}

.editor-area :deep(ul),
.editor-area :deep(ol) {
  margin: 8px 0 8px 20px;
  padding: 0;
}

.loading {
  color: #8b949e;
  padding: 16px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 16px;
  background: #0F0F0F;
  /* border-top: 1px solid #30363d; */
}

.action-btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
}

.action-btn.cancel {
  background: transparent;
  border: 1px solid #30363d;
  color: #c9d1d9;
}

.action-btn.cancel:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.action-btn.comment {
  background: #388bfd;
  border: none;
  color: white;
}

.action-btn.comment:hover:not(:disabled) {
  background: #1f6feb;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}


/* Headings */
.editor-area :deep(.tiptap h1) { font-size: 2em; margin: 0.67em 0; font-weight: bold; }
.editor-area :deep(.tiptap h2) { font-size: 1.5em; margin: 0.75em 0; font-weight: bold; }
.editor-area :deep(.tiptap h3) { font-size: 1.17em; margin: 1em 0; font-weight: bold; }

/* Inline marks */
.editor-area :deep(.tiptap strong),
.editor-area :deep(.tiptap b) { font-weight: 700; }
.editor-area :deep(.tiptap em),
.editor-area :deep(.tiptap i) { font-style: italic; }
.editor-area :deep(.tiptap s),
.editor-area :deep(.tiptap del),
.editor-area :deep(.tiptap .strike) { text-decoration: line-through; }

/* Links */
.editor-area :deep(.tiptap a) {
  color: #58a6ff;
  text-decoration: underline;
  cursor: pointer;
}

.editor-area :deep(.tiptap a:hover) {
  color: #79c0ff;
}

/* Superscript */
.editor-area :deep(.tiptap sup),
.editor-area :deep(.tiptap .superscript) {
  vertical-align: super;
  font-size: 0.8em;
  line-height: 0;
}

.editor-area :deep(.tiptap .spoiler) {
  background: #21262d;
  color: #79c0ff;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.95em;
  cursor: pointer;
}

/* Reveal on hover (classic Reddit spoiler behavior) */
.editor-area :deep(.tiptap .spoiler:hover),
.editor-area :deep(.tiptap .spoiler:focus-visible) {
  background: transparent;
  color: inherit;
  border: none;
}

.editor-area :deep(.tiptap hr) {
  border: none;
  border-top: 1px solid #30363d;
  margin: 16px 0;
}

</style>
