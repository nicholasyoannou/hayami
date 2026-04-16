<script setup lang="ts">
import { computed, ref } from 'vue';
import { CLEARABLE_CATEGORIES, type ClearableCategoryId } from './clear-storage-categories';

type Props = {
  backIcon: string;
  settingsIcon: string;
  isLargeLayout?: boolean;
  onBack: () => void;
  onClear: (categoryIds: ClearableCategoryId[]) => Promise<void>;
};

const props = defineProps<Props>();

const selected = ref<Set<ClearableCategoryId>>(new Set());
const confirming = ref(false);
const clearing = ref(false);

const allSelected = computed(() =>
  CLEARABLE_CATEGORIES.every((c) => selected.value.has(c.id)),
);

const selectedCount = computed(() => selected.value.size);

const selectedCategories = computed(() =>
  CLEARABLE_CATEGORIES.filter((c) => selected.value.has(c.id)),
);

function toggle(id: ClearableCategoryId) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function toggleSelectAll() {
  if (allSelected.value) {
    selected.value = new Set();
  } else {
    selected.value = new Set(CLEARABLE_CATEGORIES.map((c) => c.id));
  }
}

function requestConfirm() {
  if (selectedCount.value === 0) return;
  confirming.value = true;
}

function cancelConfirm() {
  confirming.value = false;
}

async function doClear() {
  if (clearing.value) return;
  clearing.value = true;
  try {
    await props.onClear(Array.from(selected.value));
    selected.value = new Set();
    confirming.value = false;
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div v-if="!props.isLargeLayout" class="mb-3 flex items-center justify-between">
    <button class="flex items-center gap-2 text-sm text-white/70 hover:text-white" @click="props.onBack()">
      <img :src="props.backIcon" alt="Back" class="h-4 w-4 settings-icon" />
      <span>Back</span>
    </button>
    <div class="flex items-center gap-2 text-lg font-semibold">
      <img :src="props.settingsIcon" alt="Clear storage" class="h-6 w-6 settings-icon" />
      <span>Clear storage</span>
    </div>
  </div>

  <div v-if="props.isLargeLayout" class="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
    <img :src="props.settingsIcon" alt="Clear storage" class="h-6 w-6 settings-icon" />
    <span>Clear storage</span>
  </div>

  <div class="space-y-4">
    <div class="hy-section-card">
      <div class="hy-section-header">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-white/90">Choose what to clear</p>
          <p class="text-xs text-white/55">
            Pick any combination of categories below. Caches rebuild as you browse; manual overrides and custom sites are user-authored and won’t come back on their own.
          </p>
        </div>
        <button
          class="shrink-0 rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
          @click="toggleSelectAll"
        >
          {{ allSelected ? 'Clear selection' : 'Select all' }}
        </button>
      </div>

      <div>
        <label
          v-for="category in CLEARABLE_CATEGORIES"
          :key="category.id"
          class="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-white/[0.03] border-b border-white/[0.06] last:border-b-0"
        >
          <input
            type="checkbox"
            class="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#b15a5a]"
            :checked="selected.has(category.id)"
            @change="toggle(category.id)"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-white/90">{{ category.label }}</p>
            <p class="text-xs text-white/55">{{ category.description }}</p>
          </div>
        </label>
      </div>
    </div>

    <div v-if="!confirming" class="hy-section-card">
      <div class="hy-row">
        <div class="flex-1 min-w-0">
          <p class="text-sm text-white/85">
            {{ selectedCount === 0 ? 'Nothing selected' : `${selectedCount} ${selectedCount === 1 ? 'category' : 'categories'} selected` }}
          </p>
          <p class="text-xs text-white/60">You’ll be asked to confirm before anything is removed.</p>
        </div>
        <button
          class="shrink-0 rounded-lg bg-[#5a2f2f] px-3 py-2 text-sm font-semibold text-[#ffdcdc] hover:bg-[#733838] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="selectedCount === 0"
          @click="requestConfirm"
        >
          Clear selected
        </button>
      </div>
    </div>

    <div v-else class="hy-section-card">
      <div class="px-4 py-3">
        <p class="text-sm font-semibold text-white/90">Confirm clear</p>
        <p class="mt-1 text-xs text-white/60">The following will be permanently removed from this device:</p>
        <ul class="mt-2 list-disc pl-5 text-xs text-white/80">
          <li v-for="category in selectedCategories" :key="category.id">{{ category.label }}</li>
        </ul>
        <div class="mt-3 flex items-center justify-end gap-2">
          <button
            class="rounded-lg bg-white/[0.08] px-3 py-2 text-sm font-semibold text-white hover:bg-white/15"
            :disabled="clearing"
            @click="cancelConfirm"
          >
            Cancel
          </button>
          <button
            class="rounded-lg bg-[#5a2f2f] px-3 py-2 text-sm font-semibold text-[#ffdcdc] hover:bg-[#733838] disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="clearing"
            @click="doClear"
          >
            {{ clearing ? 'Clearing\u2026' : 'Yes, clear' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
