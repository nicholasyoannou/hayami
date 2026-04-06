<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';

withDefaults(defineProps<{
  count?: number;
}>(), {
  count: 6
});
</script>

<template>
  <section id="ri-loading-skeleton">
    <div class="ri-toolbar" style="opacity:0.5;">
      <div class="ri-sort">
        Sort by: <select class="ri-sort-select" disabled><option>Best</option></select>
      </div>
      <div class="ri-search">
        <input 
          type="search" 
          placeholder="Search comments" 
          class="ri-search-input" 
          disabled
        />
      </div>
    </div>
    <div class="ri-header" style="opacity:0.5;">
      <h3 class="ri-title skeleton-shimmer"></h3>
    </div>
    <div class="ri-meta skeleton-shimmer" style="opacity:0.5;"></div>
    <div class="ri-comments">
      <LoadingSkeleton :count="count" />
    </div>
  </section>
</template>

<style scoped>
.skeleton-shimmer {
  background: linear-gradient(90deg, var(--ri-surface-1, #2c2c2c) 25%, var(--ri-surface-2, #1a1a1a) 50%, var(--ri-surface-1, #2c2c2c) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

.ri-title.skeleton-shimmer {
  height: 20px;
}

.ri-meta.skeleton-shimmer {
  height: 16px;
  margin: 6px 0 12px;
  width: 200px;
}
</style>
