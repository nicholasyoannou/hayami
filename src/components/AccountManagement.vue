<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { commentProviderOptions, type CommentProviderOption } from '@/config/options';
import { commentsProviderItem } from '@/config/storage';
import { useAccountManagement } from '@/composables/useAccountManagement';

const { accounts, getAccountActions } = useAccountManagement();

const props = defineProps<{ hideRedditConnect?: boolean }>();

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
    <div class="account-card-grid">
      <div
        class="account-card"
        :class="[`account-card--${account.id}`]"
        v-for="account in accounts"
        :key="account.id"
      >
        <div class="card-left">
          <div class="icon-wrapper" :class="`icon-wrapper--${account.id}`">
            <img :src="account.icon" :alt="account.name" class="account-icon" />
          </div>
          <div class="card-info">
            <div class="card-name-row">
              <p class="account-name">{{ account.name }}</p>
              <span v-if="defaultProvider === account.id" class="default-badge">Default</span>
            </div>
            <p class="account-status">
              {{ account.isConnected
                ? (account.username
                    ? account.username
                    : (account.id === 'reddit' || account.id === 'disqus')
                      ? 'Connected via browser session'
                      : 'Connected')
                : 'Not connected' }}
            </p>
          </div>
        </div>

        <div class="card-actions">
          <button
            v-if="account.requiresAuth"
            class="connect-btn"
            :class="{ 'connect-btn--disconnect': account.isConnected }"
            :disabled="account.isLoading"
            @click="handleAccountAction(account.id)"
          >
            <span v-if="account.isLoading" class="btn-spinner"></span>
            <span v-else>{{ account.isConnected ? 'Disconnect' : 'Connect' }}</span>
          </button>
          <button
            v-if="defaultProvider !== account.id"
            class="set-default-btn"
            @click="setDefault(account.id)"
          >
            Set Default
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
}

.account-card-grid {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
}

.account-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.2s ease;
}

.account-card:first-child {
  padding-top: 0;
}

.account-card:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

/* Left side: icon + info */
.card-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.icon-wrapper {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.icon-wrapper--reddit { background: rgba(255, 69, 0, 0.12); }
.icon-wrapper--disqus { background: rgba(45, 137, 239, 0.12); }
.icon-wrapper--youtube { background: rgba(255, 0, 0, 0.1); }
.icon-wrapper--mal { background: rgba(46, 81, 162, 0.15); }
.icon-wrapper--anilist { background: rgba(2, 169, 255, 0.12); }

.account-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.card-name-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.account-name {
  font-size: 14.5px;
  font-weight: 600;
  color: white;
  margin: 0;
  line-height: 1.2;
}

.default-badge {
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.18);
  color: #a5b4fc;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  border: 1px solid rgba(99, 102, 241, 0.3);
  white-space: nowrap;
}

.account-status {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.4);
  margin: 0;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Right side: action buttons */
.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.connect-btn {
  padding: 6px 16px;
  border-radius: 8px;
  background: rgba(91, 168, 255, 0.13);
  color: #93c5fd;
  border: 1px solid rgba(91, 168, 255, 0.22);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  white-space: nowrap;
}

.connect-btn:hover:not(:disabled) {
  background: rgba(91, 168, 255, 0.22);
  border-color: rgba(91, 168, 255, 0.38);
  color: #bfdbfe;
}

.connect-btn--disconnect {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.5);
  border-color: rgba(255, 255, 255, 0.1);
}

.connect-btn--disconnect:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.28);
  color: #fca5a5;
}

.connect-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-spinner {
  width: 11px;
  height: 11px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: rgba(255, 255, 255, 0.6);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.set-default-btn {
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.set-default-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.28);
  color: #a5b4fc;
}
</style>
