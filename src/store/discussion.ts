import { createPinia, defineStore, setActivePinia } from 'pinia';

export const discussionPinia = createPinia();
setActivePinia(discussionPinia);

export const useDiscussionStore = defineStore('discussion', {
  state: () => ({
    isLoading: false,
    error: null as string | null,
  }),
  actions: {
    startLoading() {
      this.isLoading = true;
      this.error = null;
    },
    clearLoading() {
      this.isLoading = false;
    },
    setError(err: string) {
      this.error = err;
      this.isLoading = false;
    },
  },
});
