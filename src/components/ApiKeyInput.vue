<script setup lang="ts">
import { ref, computed } from 'vue';

interface Props {
  modelValue?: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'password';
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  success?: string;
  infoUrl?: string;
}

interface Emits {
  (e: 'update:modelValue', value: string): void;
  (e: 'save'): void;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  type: 'password',
  disabled: false,
  loading: false,
  error: '',
  success: '',
  infoUrl: undefined
});

const emit = defineEmits<Emits>();

const internalValue = computed({
  get: () => props.modelValue || '',
  set: (value: string) => emit('update:modelValue', value)
});

const handleSave = () => {
  if (!props.disabled && !props.loading) {
    emit('save');
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    handleSave();
  }
};
</script>

<template>
  <div class="api-key-input">
    <label class="api-key-input__label">
      <span>{{ label }}</span>
      <a
        v-if="infoUrl"
        :href="infoUrl"
        target="_blank"
        rel="noreferrer"
        class="api-key-input__info"
        aria-label="Open documentation"
      >
        <span class="api-key-input__info-glyph" aria-hidden="true">i</span>
      </a>
    </label>
    <div class="api-key-input__container">
      <input
        :type="type"
        v-model="internalValue"
        autocomplete="off"
        spellcheck="false"
        :disabled="disabled || loading"
        :placeholder="placeholder"
        class="api-key-input__field"
        @keydown="handleKeydown"
      />
      <button
        class="api-key-input__save-btn"
        :disabled="disabled || loading"
        @click="handleSave"
      >
        <span v-if="loading" class="api-key-input__loading">...</span>
        <span v-else>Save</span>
      </button>
    </div>
    
    <!-- Error message -->
    <div v-if="error" class="api-key-input__message api-key-input__error">
      {{ error }}
    </div>
    
    <!-- Success message -->
    <div v-if="success" class="api-key-input__message api-key-input__success">
      {{ success }}
    </div>
  </div>
</template>

<style scoped>
.api-key-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.api-key-input__label {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.api-key-input__info {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.65);
  text-decoration: none;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  width: 16px;
  height: 16px;
  padding: 1.15px;
  line-height: 1;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.api-key-input__info:hover {
  color: white;
  border-color: rgba(255, 255, 255, 0.45);
}

.api-key-input__info-icon {
  width: 14px;
  height: 14px;
  display: block;
}

.api-key-input__info-glyph {
  display: inline-flex;
  width: 10px;
  height: 10px;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
}

.api-key-input__container {
  display: flex;
  gap: 8px;
  width: 100%;
}

.api-key-input__field {
  flex: 1 1 auto;
  min-width: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  padding: 8px 12px;
  font-size: 14px;
  color: white;
  border: 1px solid transparent;
}

.api-key-input__field::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.api-key-input__field:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.3);
}

.api-key-input__field:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.api-key-input__save-btn {
  flex: 0 0 auto;
  white-space: nowrap;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.15);
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 600;
  color: white;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 60px;
}

.api-key-input__save-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
}

.api-key-input__save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.api-key-input__loading {
  display: inline-block;
  animation: pulse 1.5s ease-in-out infinite;
}

.api-key-input__message {
  font-size: 12px;
  margin-top: 4px;
}

.api-key-input__error {
  color: #ef4444;
}

.api-key-input__success {
  color: #10b981;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
