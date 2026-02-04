<template>
  <div class="max-w-md w-full bg-gray-800 rounded-lg shadow-xl p-6">
    <!-- Success Header -->
    <div class="text-center mb-8">
      <div class="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>
      </div>
      <h1 class="text-2xl font-bold text-green-400 mb-2">Hayami Plus Activated!</h1>
      <p class="text-gray-300">Your subscription has been successfully linked.</p>
    </div>

    <!-- Subscription Info -->
    <div class="bg-gray-700 rounded-lg p-4 mb-6">
      <h2 class="text-lg font-semibold text-gray-200 mb-4">Subscription Details</h2>
      
      <div class="space-y-3">
        <div>
          <label class="text-sm text-gray-400 block mb-1">API Key</label>
          <div class="bg-gray-600 rounded px-3 py-2 font-mono text-sm">
            {{ redactedApiKey }}
          </div>
        </div>
        
        <div>
          <label class="text-sm text-gray-400 block mb-1">Subscription ID</label>
          <div class="bg-gray-600 rounded px-3 py-2 font-mono text-sm">
            {{ redactedSubscriptionId }}
          </div>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="space-y-3">
      <button
        @click="toggleShowFull"
        class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition-colors"
      >
        {{ showFull ? 'Hide' : 'Show' }} Full Details
      </button>
      
      <button
        @click="clearCredentials"
        class="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded transition-colors"
      >
        Clear Credentials
      </button>
    </div>

    <!-- Full Details (when shown) -->
    <div v-if="showFull" class="mt-6 bg-gray-700 rounded-lg p-4">
      <h3 class="text-lg font-semibold text-gray-200 mb-3">Full Credentials</h3>
      <div class="space-y-2">
        <div>
          <label class="text-sm text-gray-400 block mb-1">Full API Key</label>
          <div class="bg-gray-600 rounded px-3 py-2 font-mono text-sm break-all">
            {{ storedApiKey || 'Not set' }}
          </div>
        </div>
        
        <div>
          <label class="text-sm text-gray-400 block mb-1">Full Subscription ID</label>
          <div class="bg-gray-600 rounded px-3 py-2 font-mono text-sm break-all">
            {{ storedSubscriptionId || 'Not set' }}
          </div>
        </div>
      </div>
    </div>

    <!-- Status Messages -->
    <div v-if="statusMessage" class="mt-4 p-3 rounded" :class="statusType === 'success' ? 'bg-green-600 text-green-100' : 'bg-red-600 text-red-100'">
      {{ statusMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { browser } from 'wxt/browser'
import { ref, computed, onMounted } from 'vue'

// Reactive state
const storedApiKey = ref<string>('')
const storedSubscriptionId = ref<string>('')
const showFull = ref<boolean>(false)
const statusMessage = ref<string>('')
const statusType = ref<'success' | 'error'>('success')

// Computed properties for redacted values
const redactedApiKey = computed(() => {
  if (!storedApiKey.value) return 'Not set'
  const apiKey = storedApiKey.value
  if (apiKey.length <= 8) return '*'.repeat(apiKey.length)
  return apiKey.substring(0, 4) + '*'.repeat(apiKey.length - 8) + apiKey.substring(apiKey.length - 4)
})

const redactedSubscriptionId = computed(() => {
  if (!storedSubscriptionId.value) return 'Not set'
  return '*'.repeat(storedSubscriptionId.value.length)
})

// Load credentials from sync storage
const loadCredentials = async () => {
  try {
    console.log('Loading credentials from storage...')
    const result = await browser.storage.sync.get([
      'hayamiPlusApiKey',
      'hayamiPlusSubscriptionId',
    ]) as {
      hayamiPlusApiKey?: string
      hayamiPlusSubscriptionId?: string
    }
    console.log('Storage result:', result)
    storedApiKey.value = result.hayamiPlusApiKey || ''
    storedSubscriptionId.value = result.hayamiPlusSubscriptionId || ''
    console.log('Loaded credentials:', { apiKey: storedApiKey.value, subscriptionId: storedSubscriptionId.value })
  } catch (error) {
    console.error('Error loading credentials:', error)
    showStatus('Error loading credentials', 'error')
  }
}

// Save credentials to sync storage
const saveCredentials = async (apiKey: string, subscriptionId: string) => {
  try {
    await browser.storage.sync.set({
      hayamiPlusApiKey: apiKey,
      hayamiPlusSubscriptionId: subscriptionId
    })
    storedApiKey.value = apiKey
    storedSubscriptionId.value = subscriptionId
    showStatus('Credentials saved successfully', 'success')
  } catch (error) {
    console.error('Error saving credentials:', error)
    showStatus('Error saving credentials', 'error')
  }
}

// Clear credentials from sync storage
const clearCredentials = async () => {
  try {
    await browser.storage.sync.remove(['hayamiPlusApiKey', 'hayamiPlusSubscriptionId'])
    storedApiKey.value = ''
    storedSubscriptionId.value = ''
    showFull.value = false
    showStatus('Credentials cleared successfully', 'success')
  } catch (error) {
    console.error('Error clearing credentials:', error)
    showStatus('Error clearing credentials', 'error')
  }
}

// Toggle full details visibility
const toggleShowFull = () => {
  showFull.value = !showFull.value
}

// Show status message
const showStatus = (message: string, type: 'success' | 'error') => {
  statusMessage.value = message
  statusType.value = type
  setTimeout(() => {
    statusMessage.value = ''
  }, 3000)
}

// Handle URL parameters on mount
onMounted(async () => {
  console.log('HayamiPlus page mounted')
  console.log('Current URL:', window.location.href)
  console.log('Search params:', window.location.search)
  
  // Load existing credentials first
  await loadCredentials()
  
  // Check for URL parameters
  const urlParams = new URLSearchParams(window.location.search)
  const apiKey = urlParams.get('apiKey')
  const subscriptionId = urlParams.get('subscriptionId')
  
  console.log('URL parameters:', { apiKey, subscriptionId })
  
  if (apiKey && subscriptionId) {
    console.log('Saving new credentials...')
    await saveCredentials(apiKey, subscriptionId)
  } else {
    console.log('No URL parameters found')
  }
})
</script>
