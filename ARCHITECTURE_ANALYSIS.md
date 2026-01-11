# Architecture Analysis & Improvement Plan

## Current State Analysis

### ✅ What's Working Well
1. **Reddit Comments**: Already using Vue components (`RedditCommentList.vue`, `RedditComment.vue`)
2. **Templates Extracted**: HTML templates are in separate files (good organization)
3. **State Management**: Centralized state module exists
4. **Provider Abstraction**: Provider pattern implemented

### ❌ Issues Identified

#### 1. **Mixed Rendering Approaches** (Critical)
- **Reddit**: Vue components ✅
- **YouTube**: `innerHTML` with manual event handlers ❌
- **MAL**: `innerHTML` with manual event handlers ❌
- **Disqus**: `innerHTML` (external script) ⚠️
- **Overlays/Modals**: `innerHTML` ❌
- **Legacy Reddit**: `renderComments()` function still uses `innerHTML` ❌

**Problems:**
- Inconsistent patterns make code harder to maintain
- Manual event handler management is error-prone
- No reactivity for YouTube/MAL content
- Security concerns with `innerHTML` (XSS risk)
- Harder to test and debug

#### 2. **HTML Generation Statistics**
- **29 instances** of `.innerHTML =` in `index.ts`
- **~500+ lines** of HTML template strings
- **Manual DOM manipulation** for interactive elements
- **No type safety** for HTML generation

#### 3. **WXT Best Practices Not Fully Utilized**
- Not using `createIntegratedUi` or `createShadowRootUi` helpers
- Manual Vue app mounting instead of WXT's UI utilities
- Missing CSS isolation for content script UI

## WXT Best Practices (From Documentation)

### Recommended Approach for Content Scripts

1. **Use Vue Components for Interactive Content**
   ```ts
   const ui = createIntegratedUi(ctx, {
     position: 'inline',
     anchor: 'body',
     onMount: (container) => {
       const app = createApp(App);
       app.mount(container);
       return app;
     },
   });
   ```

2. **Use Shadow Root for Style Isolation**
   ```ts
   const ui = await createShadowRootUi(ctx, {
     name: 'example-ui',
     cssInjectionMode: 'ui',
     onMount: (container) => {
       const app = createApp(App);
       app.mount(container);
       return app;
     },
   });
   ```

3. **Avoid `innerHTML` for Dynamic Content**
   - Use Vue's reactive templates
   - Use `v-html` only when necessary (with sanitization)
   - Prefer component props and slots

## Improvement Plan

### Phase 1: Convert YouTube Comments to Vue Component (High Priority)

**Current:** `renderYouTubeComments()` - 290 lines of `innerHTML` + manual event handlers

**Target:** `YouTubeCommentList.vue` component

**Benefits:**
- Reactive state management
- Automatic event handling
- Better performance (Vue's virtual DOM)
- Type safety
- Easier to test

**Steps:**
1. Create `src/components/comments/YouTubeCommentList.vue`
2. Create `src/components/comments/YouTubeComment.vue`
3. Move infinite scroll logic to Vue composable
4. Replace `renderYouTubeComments()` calls with component mounting

### Phase 2: Convert MAL Forums to Vue Component

**Current:** `renderMalForumResult()` - Uses `innerHTML` for posts and topics

**Target:** `MALForumView.vue` component

**Steps:**
1. Create `src/components/providers/MALForumView.vue`
2. Create `src/components/providers/MALTopicList.vue`
3. Create `src/components/providers/MALPost.vue`
4. Move pagination logic to Vue

### Phase 3: Convert Overlays/Modals to Vue Components

**Current:** Multiple overlay functions using `innerHTML`

**Target:** Vue modal components

**Steps:**
1. Create `src/components/modals/RedditSelectionModal.vue`
2. Create `src/components/modals/ManualSearchModal.vue`
3. Create `src/components/modals/AuthPromptModal.vue`
4. Use Vue's `Teleport` for modals

### Phase 4: Remove Legacy `renderComments()` Function

**Current:** `renderComments()` - 400+ lines of `innerHTML` + manual DOM manipulation

**Target:** Already have `RedditCommentList.vue`, just need to remove legacy code

**Steps:**
1. Verify all Reddit comment rendering uses Vue components
2. Remove `renderComments()` function
3. Clean up related helper functions

### Phase 5: Adopt WXT UI Helpers

**Current:** Manual Vue app mounting

**Target:** Use `createIntegratedUi` or `createShadowRootUi`

**Benefits:**
- Automatic cleanup
- Better lifecycle management
- CSS isolation option
- Consistent with WXT patterns

### Phase 6: Security & Type Safety

1. **Replace all `any` types** with proper interfaces
2. **Sanitize HTML** if `v-html` is needed
3. **Use TypeScript strict mode** for better type checking

## Migration Strategy

### Incremental Approach

1. **Start with YouTube** (most complex, biggest win)
2. **Then MAL** (similar complexity)
3. **Then Overlays** (simpler, quick wins)
4. **Finally cleanup** (remove legacy code)

### Risk Mitigation

- Keep old functions until new components are tested
- Use feature flags to switch between old/new
- Test each provider independently
- Maintain backward compatibility during migration

## Expected Outcomes

### Code Quality
- ✅ Consistent Vue component pattern
- ✅ Better type safety
- ✅ Reduced code size (~500 lines of HTML → components)
- ✅ Easier to test and maintain

### Performance
- ✅ Vue's reactivity system
- ✅ Better DOM diffing
- ✅ Automatic cleanup

### Security
- ✅ No XSS risks from `innerHTML`
- ✅ Vue's built-in escaping
- ✅ Type-safe props

### Developer Experience
- ✅ Better IDE support
- ✅ Easier debugging
- ✅ Component reusability
- ✅ Follows WXT best practices

## Questions to Consider

1. **Disqus**: Should we keep `innerHTML` for Disqus since it's an external script, or wrap it in a Vue component?
2. **Shadow Root**: Should we use `createShadowRootUi` for better CSS isolation?
3. **Templates**: Keep template functions for simple static HTML, or convert everything to components?

## Next Steps

1. Review this analysis
2. Prioritize which phase to start with
3. Create detailed implementation plan for Phase 1 (YouTube)
4. Begin migration incrementally
