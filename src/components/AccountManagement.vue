<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { commentProviderOptions, type CommentProviderOption } from '@/config/options';
import { commentsProviderItem } from '@/config/storage';
import { useAccountManagement } from '@/composables/useAccountManagement';

const { accounts, getAccountActions } = useAccountManagement();

const defaultProvider = ref<CommentProviderOption>('reddit');

const emit = defineEmits<{
  accountsUpdated: [accounts: ConnectedAccounts];
}>();

interface ConnectedAccounts {
  reddit: boolean;
  youtube: boolean;
  mal: boolean;
  anilist: boolean;
  disqus: boolean;
}

// Helper function to emit account updates
function emitAccountsUpdated() {
  const connectedAccounts: ConnectedAccounts = {
    reddit: accounts.value.find(acc => acc.id === 'reddit')?.isConnected || false,
    youtube: accounts.value.find(acc => acc.id === 'youtube')?.isConnected || false,
    mal: accounts.value.find(acc => acc.id === 'mal')?.isConnected || false,
    anilist: accounts.value.find(acc => acc.id === 'anilist')?.isConnected || false,
    disqus: accounts.value.find(acc => acc.id === 'disqus')?.isConnected || true,
  };
  emit('accountsUpdated', connectedAccounts);
}

// Account action handlers
function handleAccountAction(accountId: string) {
  const actions = getAccountActions(accountId);
  const account = accounts.value.find(acc => acc.id === accountId);
  
  if (!account?.requiresAuth) return;

  if (account.isConnected) {
    actions.disconnect().then(() => {
      emitAccountsUpdated();
    });
  } else {
    actions.connect().then(() => {
      emitAccountsUpdated();
    });
  }
}

const isProviderOption = (providerId: string): providerId is CommentProviderOption =>
  commentProviderOptions.some((option) => option.value === providerId);

async function setDefault(providerId: string) {
  if (!isProviderOption(providerId)) return;
  defaultProvider.value = providerId;
  await commentsProviderItem.setValue(providerId);
}

onMounted(async () => {
  const stored = await commentsProviderItem.getValue();
  if (isProviderOption(stored)) {
    defaultProvider.value = stored;
  }
});
</script>

<template>
  <div class="account-management">
    <div class="account-management-grid">
      <div class="account-item" v-for="account in accounts" :key="account.id">
        <div class="account-item-left">
          <img :src="account.icon" :alt="account.name" class="account-icon" />
          <div class="account-info">
            <div class="account-title-row">
              <p class="account-provider">{{ account.name }}</p>
              <span v-if="defaultProvider === account.id" class="default-pill">Default</span>
            </div>
            <p class="account-status">
              {{ account.requiresAuth
                ? (account.isConnected
                    ? (account.username ? `${account.username}` : 'Connected')
                    : 'Not connected')
                : 'No login required' }}
            </p>
          </div>
        </div>
        <div class="account-actions">
          <button 
            v-if="account.requiresAuth"
            class="account-btn" 
            :disabled="account.isLoading" 
            @click="handleAccountAction(account.id)"
          >
            {{ account.isConnected ? 'Logout' : 'Connect' }}
          </button>
          <button
            class="default-btn"
            :class="{ 'default-btn--active': defaultProvider === account.id }"
            :disabled="defaultProvider === account.id"
            @click="setDefault(account.id)"
          >
            <span v-if="defaultProvider === account.id">Default</span>
            <span v-else>Make default</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.account-management {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.account-management-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.5;
}

.account-management-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.account-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-radius: 16px;
  background: rgba(40, 40, 50, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.2s ease;
}

.account-item:hover {
  background: rgba(40, 40, 50, 0.9);
  border-color: rgba(255, 255, 255, 0.2);
}

.account-item-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.account-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.account-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  padding: 8px;
  flex-shrink: 0;
}

.account-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.account-provider {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  margin: 0;
}

.account-status {
  font-size: 16px;
  font-weight: 600;
  color: white;
  margin: 0;
}

.account-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.account-btn {
  padding: 8px 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.account-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
}

.account-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.default-btn {
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.default-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
}

.default-btn:disabled {
  opacity: 0.8;
  cursor: default;
}

.default-btn--active {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.5);
}

.default-pill {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.2);
  color: #c7d2fe;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid rgba(99, 102, 241, 0.4);
}
</style>
