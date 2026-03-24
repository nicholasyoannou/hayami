<script lang="ts" setup>
import { computed } from 'vue';
import ApiKeyInput from '@/components/ApiKeyInput.vue';

type OptionEntry<T = any> = { value: T; label: string };

interface SettingDef {
  key: string;
  type: 'select' | 'toggle' | 'segmented' | 'slider' | 'apiKey';
  inputType?: 'text' | 'password';
  label: string;
  description?: string;
  infoUrl?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}

const props = defineProps<{
  setting: SettingDef;
  modelValue: any;
  options: ReadonlyArray<OptionEntry>;
  disabled?: boolean;
  variant?: 'primary' | 'advanced';
  padding?: 'normal' | 'compact';
  formattedSliderValue?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void;
  (e: 'save', value: any): void;
}>();

const bgClass = computed(() =>
  props.variant === 'advanced' ? 'bg-black/15' : 'bg-white/5'
);

const paddingClass = computed(() =>
  props.padding === 'compact' ? 'px-3 py-3' : 'px-4 py-3'
);
</script>

<template>
  <div
    class="flex items-start justify-between gap-3 rounded-xl"
    :class="[bgClass, paddingClass, disabled ? 'opacity-50 pointer-events-none' : '']"
  >
    <div v-if="setting.type !== 'apiKey'" class="flex-1">
      <p class="text-sm text-white/80">{{ setting.label }}</p>
      <p v-if="setting.description" class="text-xs text-white/60">{{ setting.description }}</p>
    </div>
    <div v-else-if="setting.description" class="flex-1">
      <p class="text-xs text-white/60">{{ setting.description }}</p>
    </div>
    <div :class="setting.type === 'apiKey' ? 'min-w-0 flex-1' : 'shrink-0'">
      <template v-if="setting.type === 'select'">
        <select
          class="w-52 min-w-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
          :value="modelValue"
          :disabled="disabled"
          @change="(e) => emit('save', (e.target as HTMLSelectElement).value)"
        >
          <option
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            class="bg-[#1f2329]"
          >
            {{ option.label }}
          </option>
        </select>
      </template>

      <template v-else-if="setting.type === 'toggle'">
        <label class="relative inline-flex items-center">
          <input
            type="checkbox"
            class="peer sr-only"
            :checked="Boolean(modelValue)"
            @change="(e) => emit('save', (e.target as HTMLInputElement).checked)"
          />
          <div class="peer h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-emerald-400 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"></div>
        </label>
      </template>

      <template v-else-if="setting.type === 'segmented'">
        <div class="flex gap-2 text-sm font-semibold">
          <button
            v-for="option in options"
            :key="option.value"
            class="rounded-lg px-3 py-2"
            :class="modelValue === option.value ? 'bg-white/15' : 'bg-white/5'"
            @click="emit('save', option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </template>

      <template v-else-if="setting.type === 'slider'">
        <div class="flex items-center gap-3">
          <input
            type="range"
            :min="setting.min"
            :max="setting.max"
            :step="setting.step"
            :value="modelValue as number"
            :disabled="disabled"
            @input="(e) => emit('save', parseFloat((e.target as HTMLInputElement).value))"
            class="w-24"
          />
          <span class="w-14 text-right text-sm font-semibold text-white/80">{{ formattedSliderValue }}</span>
        </div>
      </template>

      <template v-else-if="setting.type === 'apiKey'">
        <ApiKeyInput
          :model-value="(modelValue as string)"
          :label="setting.label"
          :type="setting.inputType || 'password'"
          :placeholder="setting.placeholder"
          :info-url="setting.infoUrl"
          :disabled="disabled"
          @update:model-value="(v: string) => emit('update:modelValue', v)"
          @save="() => emit('save', modelValue || '')"
        />
      </template>
    </div>
  </div>
</template>
