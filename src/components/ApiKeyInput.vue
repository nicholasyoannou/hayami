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
  success: ''
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
    <label class="api-key-input__label">{{ label }}</label>
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
}

.api-key-input__label {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
}

.api-key-input__container {
  display: flex;
  gap: 8px;
}

.api-key-input__field {
  flex: 1;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  padding: 8px 12px;
  font-size: 14px;
  color: white;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.api-key-input__field::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.api-key-input__field:focus {
  outline: 2px solid rgba(255, 255, 255, 0.3);
  outline-offset: -2px;
}

.api-key-input__field:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.api-key-input__save-btn {
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
