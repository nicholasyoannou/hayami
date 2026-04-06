<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { commentProviderOptions, type CommentProviderOption } from '@/config/options';
import SettingField from './SettingField.vue';

type OptionEntry<T = any> = { value: T; label: string };

type SettingDefinition = {
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
  advanced?: boolean;
  options?: ReadonlyArray<OptionEntry>;
  category: string;
  providerId?: CommentProviderOption;
};

type Props = {
  backIcon: string;
  discussionPlatformsIcon: string;
  isLargeLayout: boolean;
  settingDefinitions: SettingDefinition[];
  settingValues: Record<string, any>;
  providerIcons: Record<CommentProviderOption, string>;
  onBack: () => void;
  onSettingChange: (setting: SettingDefinition, value: any) => void;
  onSettingValueUpdate: (key: string, value: any) => void;
  formatSliderValue: (setting: SettingDefinition, value: any) => string;
  getSettingOptions: (setting: SettingDefinition) => ReadonlyArray<OptionEntry>;
};

const props = defineProps<Props>();

const providerSections = computed(() =>
  commentProviderOptions.map((provider) => ({
    id: provider.value,
    label: provider.label,
    icon: props.providerIcons[provider.value],
    settings: props.settingDefinitions.filter(
      (setting) => setting.category === 'provider' && setting.providerId === provider.value,
    ),
  })),
);

const selectedProvider = ref<CommentProviderOption>(providerSections.value[0]?.id || commentProviderOptions[0].value);
const providerAdvancedExpanded = ref(false);

watch(selectedProvider, () => {
  providerAdvancedExpanded.value = false;
});

const activeProviderSection = computed(() => providerSections.value.find((p) => p.id === selectedProvider.value));

const activeProviderPrimarySettings = computed(() =>
  (activeProviderSection.value?.settings || []).filter((s) => !s.advanced),
);

const activeProviderAdvancedSettings = computed(() =>
  (activeProviderSection.value?.settings || []).filter((s) => Boolean(s.advanced)),
);
</script>

<template>
  <div>
    <div v-if="!isLargeLayout" class="mb-3 flex items-center justify-between">
      <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="onBack">
        <img :src="backIcon" alt="Back" class="h-4 w-4 settings-icon" />
        <span>Back</span>
      </button>
      <div class="flex items-center gap-2 text-lg font-semibold">
        <img :src="discussionPlatformsIcon" alt="Discussion platforms" class="h-6 w-6 settings-icon" />
        <span>Discussion platforms</span>
      </div>
    </div>

    <div v-if="isLargeLayout" class="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
      <img :src="discussionPlatformsIcon" alt="Discussion platforms" class="h-6 w-6 settings-icon" />
      <span>Discussion platforms</span>
    </div>

    <div class="space-y-4">
      <div class="flex items-center gap-3 px-1">
        <label class="text-sm text-white/70">Choose platform</label>
        <select
          class="w-44 min-w-0 rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm font-semibold text-white focus:outline focus:outline-2 focus:outline-white/30"
          v-model="selectedProvider"
        >
          <option
            v-for="provider in providerSections"
            :key="provider.id"
            :value="provider.id"
            class="bg-[#1f2329]"
          >
            {{ provider.label }}
          </option>
        </select>
      </div>

      <div v-if="activeProviderSection" class="hy-section-card">
        <div class="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
          <img
            v-if="activeProviderSection.icon"
            :src="activeProviderSection.icon"
            :alt="activeProviderSection.label"
            class="h-7 w-7 rounded-lg bg-white/5 p-1"
          />
          <div class="text-base font-semibold text-white/90">{{ activeProviderSection.label }}</div>
        </div>

        <template v-if="activeProviderPrimarySettings.length || activeProviderAdvancedSettings.length">
          <SettingField
            v-for="setting in activeProviderPrimarySettings"
            :key="setting.key"
            :setting="setting"
            :model-value="settingValues[setting.key]"
            :options="getSettingOptions(setting)"
            variant="primary"
            padding="compact"
            :formatted-slider-value="formatSliderValue(setting, settingValues[setting.key])"
            @update:model-value="(v) => onSettingValueUpdate(setting.key, v)"
            @save="(v) => onSettingChange(setting, v)"
          />

          <template
            v-if="activeProviderSection.id === 'reddit' && activeProviderAdvancedSettings.length"
          >
            <button
              class="flex w-full items-center justify-between border-t border-white/[0.06] px-4 py-3 text-left text-sm font-semibold text-white/85"
              :class="providerAdvancedExpanded ? 'border-b border-white/[0.06]' : ''"
              @click="providerAdvancedExpanded = !providerAdvancedExpanded"
            >
              <span>Advanced</span>
              <span class="text-xs text-white/60">{{ providerAdvancedExpanded ? 'Hide' : 'Expand' }}</span>
            </button>

            <template v-if="providerAdvancedExpanded">
              <SettingField
                v-for="setting in activeProviderAdvancedSettings"
                :key="setting.key"
                :setting="setting"
                :model-value="settingValues[setting.key]"
                :options="getSettingOptions(setting)"
                variant="advanced"
                padding="compact"
                :formatted-slider-value="formatSliderValue(setting, settingValues[setting.key])"
                @update:model-value="(v) => onSettingValueUpdate(setting.key, v)"
                @save="(v) => onSettingChange(setting, v)"
              />
            </template>
          </template>
        </template>

        <div v-else class="px-4 py-3 text-sm text-white/60">No settings available for this platform.</div>
      </div>

      <div v-else class="hy-section-card px-4 py-3 text-sm text-white/70">No discussion platforms available.</div>
    </div>
  </div>
</template>

<style scoped>
.settings-icon {
  filter: brightness(0) invert(1);
}
</style>
