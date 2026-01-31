<script lang="ts" setup>
import { useAccountManagement } from '@/composables/useAccountManagement';
import accountsIcon from '@/assets/accountsIcon.svg';

const { accounts, getAccountActions } = useAccountManagement();

const emit = defineEmits<{
  accountsUpdated: [accounts: ConnectedAccounts];
}>();

interface ConnectedAccounts {
  reddit: boolean;
  youtube: boolean;
  mal: boolean;
  anilist: boolean;
}

// Helper function to emit account updates
function emitAccountsUpdated() {
  const connectedAccounts: ConnectedAccounts = {
    reddit: accounts.value.find(acc => acc.id === 'reddit')?.isConnected || false,
    youtube: accounts.value.find(acc => acc.id === 'youtube')?.isConnected || false,
    mal: accounts.value.find(acc => acc.id === 'mal')?.isConnected || false,
    anilist: accounts.value.find(acc => acc.id === 'anilist')?.isConnected || false,
  };
  emit('accountsUpdated', connectedAccounts);
}

// Account action handlers
function handleAccountAction(accountId: string) {
  const actions = getAccountActions(accountId);
  const account = accounts.value.find(acc => acc.id === accountId);
  
  if (account?.isConnected) {
    actions.disconnect().then(() => {
      emitAccountsUpdated();
    });
  } else {
    actions.connect().then(() => {
      emitAccountsUpdated();
    });
  }
}
</script>

<template>
  <div class="account-management">
    <div class="account-management-grid">
      <div class="account-item" v-for="account in accounts" :key="account.id">
        <div class="account-item-left">
          <img :src="account.icon" :alt="account.name" class="account-icon" />
          <div class="account-info">
            <p class="account-provider">{{ account.name }}</p>
            <p class="account-status">
              {{ account.isConnected ? 
                (account.username ? `${account.username}` : 'Connected') : 
                'Not connected' 
              }}
            </p>
          </div>
        </div>
        <button 
          class="account-btn" 
          :disabled="account.isLoading" 
          @click="handleAccountAction(account.id)"
        >
          {{ account.isConnected ? 'Logout' : 'Connect' }}
        </button>
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
</style>
