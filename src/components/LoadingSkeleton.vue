<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  count?: number;
}>(), {
  count: 6
});

const skeletonItems = computed(() => Array.from({ length: props.count }));
</script>

<template>
  <div 
    v-for="(_, index) in skeletonItems" 
    :key="index" 
    class="ri-skel"
  >
    <div class="sk-ava"></div>
    <div class="sk-lines">
      <div class="sk-line w60"></div>
      <div class="sk-line w80"></div>
      <div class="sk-line w40"></div>
    </div>
  </div>
</template>
