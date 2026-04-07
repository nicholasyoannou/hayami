<script lang="ts" setup>
import { computed, ref } from 'vue';
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
  // variant/padding kept for backward compat but no longer affect layout
  variant?: 'primary' | 'advanced';
  padding?: 'normal' | 'compact';
  formattedSliderValue?: string;
  // If true, the field renders as its own standalone card (used when not
  // placed inside a section card). Default is false — the field is a flat
  // divider row that inherits the section card's surface.
  standalone?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void;
  (e: 'save', value: any): void;
}>();

const isStackedLayout = computed(
  () => props.setting.type === 'select' || props.setting.type === 'apiKey',
);

const rowClass = computed(() => {
  const base = isStackedLayout.value ? 'hy-row-stack' : 'hy-row';
  const disabled = props.disabled ? 'opacity-50 pointer-events-none' : '';
  const standalone = props.standalone
    ? 'hy-section-card !border-b-0 ring-1 ring-white/5'
    : '';
  return [base, disabled, standalone].filter(Boolean).join(' ');
});

const tooltipWidth = 192;
const tooltipVisible = ref(false);
const tooltipText = ref('');
const tooltipStyle = ref<Record<string, string>>({ left: '0px', top: '0px' });

function showHelpTooltip(event: MouseEvent | FocusEvent, text?: string) {
  if (!text) return;
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const margin = 10;
  const center = rect.left + rect.width / 2;
  const minCenter = margin + tooltipWidth / 2;
  const maxCenter = window.innerWidth - margin - tooltipWidth / 2;
  const clampedCenter = Math.min(Math.max(center, minCenter), maxCenter);

  tooltipStyle.value = {
    left: `${clampedCenter}px`,
    top: `${rect.bottom + 8}px`,
  };
  tooltipText.value = text;
  tooltipVisible.value = true;
}

function hideHelpTooltip() {
  tooltipVisible.value = false;
}
</script>

<template>
  <div :class="rowClass">
    <!-- Label area: on stacked layouts it sits above the control; on
         horizontal layouts it shares the row with the control. The help
         button is rendered inline so it hugs the end of the label text
         instead of floating to the far right of the column. -->
    <p
      v-if="setting.type !== 'apiKey'"
      class="min-w-0 flex-1 text-sm text-white/85 leading-tight"
    >
      <span class="align-middle">{{ setting.label }}</span><!--
      --><button
        v-if="setting.description"
        type="button"
        class="ml-1.5 inline-flex h-4 w-4 shrink-0 translate-y-[-1px] items-center justify-center rounded-full border border-white/25 align-middle text-[10px] font-bold text-white/70 transition hover:border-white/40 hover:text-white"
        :aria-label="`Help: ${setting.label}`"
        @mouseenter="(e) => showHelpTooltip(e, setting.description)"
        @focus="(e) => showHelpTooltip(e, setting.description)"
        @mouseleave="hideHelpTooltip"
        @blur="hideHelpTooltip"
      >?</button>
    </p>

    <div :class="isStackedLayout ? 'w-full' : 'shrink-0'">
      <template v-if="setting.type === 'select'">
        <select
          class="hy-select"
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
            :class="modelValue === option.value ? 'bg-white/15' : 'bg-white/[0.06]'"
            @click="emit('save', option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </template>

      <template v-else-if="setting.type === 'slider'">
        <div class="flex min-w-0 items-center gap-2">
          <input
            type="range"
            :min="setting.min"
            :max="setting.max"
            :step="setting.step"
            :value="modelValue as number"
            :disabled="disabled"
            @input="(e) => emit('save', parseFloat((e.target as HTMLInputElement).value))"
            class="w-24 shrink-0"
          />
          <span class="min-w-[6.5rem] text-right text-sm font-semibold text-white/80 whitespace-nowrap">{{ formattedSliderValue }}</span>
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
          :show-save-tick="true"
          @update:model-value="(v: string) => emit('update:modelValue', v)"
          @save="() => emit('save', modelValue || '')"
        />
      </template>
    </div>

    <div
      v-if="tooltipVisible && tooltipText"
      class="pointer-events-none fixed z-[9999] w-48 -translate-x-1/2 rounded-lg border border-white/15 bg-[#171c24] px-2.5 py-2 text-[11px] leading-snug text-white/80 shadow-xl whitespace-normal break-words"
      :style="tooltipStyle"
    >
      {{ tooltipText }}
    </div>
  </div>
</template>
