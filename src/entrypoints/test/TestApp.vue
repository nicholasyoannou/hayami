<template>
  <div class="test-page">
    <div class="test-header">
      <h1>Hayami Test Page</h1>
      <p>Testing Reddit comments functionality and markdown rendering</p>
      <div class="test-info">
        <strong>Reddit URL:</strong> https://www.reddit.com/r/test/comments/1qvsa71/test/
      </div>
    </div>
    
    <div class="test-content">
      <InlineDiscussion 
        :discussion="testDiscussion"
        provider="reddit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import InlineDiscussion from '@/components/InlineDiscussion.vue';
import { con } from '@/utils/logger';

const log = con.m('Test');

const testDiscussion = ref({
  id: '18da1zl',
  title: 'some_test_commands',
  author: 'test_user',
  permalink: '/r/test/comments/18da1zl/some_test_commands/',
  score: 1,
  num_comments: 0,
  subreddit: 'test',
  fullname: 't3_18da1zl'
});

onMounted(() => {
  log.log('Test page mounted with Reddit discussion:', testDiscussion.value);
});
</script>

<style scoped>
.test-page {
  min-height: 100vh;
  background: #f8f9fa;
  padding: 20px;
}

.test-header {
  background: white;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.test-header h1 {
  margin: 0 0 10px 0;
  color: #333;
}

.test-header p {
  margin: 0 0 15px 0;
  color: #666;
}

.test-info {
  background: #f1f3f4;
  padding: 10px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  word-break: break-all;
}

.test-content {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
</style>
