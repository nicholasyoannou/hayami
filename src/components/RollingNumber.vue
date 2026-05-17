<script setup lang="ts">
/**
 * Per-digit odometer. Each digit is its own fixed-height window containing a
 * 0-9 strip; columns are keyed by place value (counted from the right) so Vue
 * reuses the same column element across updates. Only digits whose value
 * actually changed get a new transform, so the CSS transition runs on those
 * columns alone — e.g. 43 -> 44 scrolls only the ones digit, the "4" is still.
 */
import { computed } from 'vue';
import { redditAnimationsEnabled } from '@/composables/useRedditAnimationsEnabled';

const props = defineProps<{ value: number; locale?: string }>();

const text = computed(() =>
  (Number.isFinite(props.value) ? props.value : 0).toLocaleString(props.locale ?? 'en-US'),
);

type Token =
  | { kind: 'd'; digit: number; key: string }
  | { kind: 's'; ch: string; key: string };

const tokens = computed<Token[]>(() => {
  const str = text.value;
  const digitCount = (str.match(/\d/g) || []).length;
  let place = digitCount; // digits still to the right of the cursor
  const out: Token[] = [];
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') {
      place--;
      out.push({ kind: 'd', digit: Number(ch), key: 'd' + place });
    } else {
      out.push({ kind: 's', ch, key: 's' + place + ch });
    }
  }
  return out;
});
</script>

<template>
  <span class="rn-root" :class="{ 'rn-static': !redditAnimationsEnabled }" :aria-label="text" role="text">
    <span class="rn-row" aria-hidden="true">
      <template v-for="t in tokens" :key="t.key">
        <span v-if="t.kind === 'd'" class="rn-digit">
          <span class="rn-strip" :style="{ transform: `translateY(-${t.digit}em)` }">
            <span v-for="n in 10" :key="n" class="rn-cell">{{ n - 1 }}</span>
          </span>
        </span>
        <span v-else class="rn-sep">{{ t.ch }}</span>
      </template>
    </span>
  </span>
</template>

<style scoped>
.rn-root { display: inline-flex; line-height: 1; }
.rn-row { display: inline-flex; }
.rn-digit { display: inline-block; height: 1em; line-height: 1; overflow: hidden; }
.rn-strip {
  display: flex;
  flex-direction: column;
  transition: transform 0.34s cubic-bezier(0.2, 0.85, 0.3, 1);
  will-change: transform;
}
.rn-cell { display: block; height: 1em; line-height: 1; text-align: center; }
.rn-sep { display: inline-block; }
.rn-static .rn-strip { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .rn-strip { transition: none; }
}
</style>
