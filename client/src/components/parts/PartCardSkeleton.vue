<template>
  <template v-if="type === 'card'">
    <div
      v-for="i in count"
      :key="i"
      class="skeleton-card"
      aria-hidden="true"
    >
      <div class="skeleton-photo skeleton-shimmer"></div>
      <div class="skeleton-body">
        <div class="skeleton-line line-60 skeleton-shimmer"></div>
        <div class="skeleton-line line-85 skeleton-shimmer"></div>
        <div class="skeleton-line line-40 skeleton-shimmer"></div>
        <div class="skeleton-bar skeleton-shimmer"></div>
        <div class="skeleton-foot">
          <div class="skeleton-qr skeleton-shimmer"></div>
          <div class="skeleton-stepper skeleton-shimmer"></div>
        </div>
      </div>
    </div>
  </template>

  <template v-else-if="type === 'row'">
    <tr
      v-for="i in count"
      :key="i"
      class="skeleton-row"
      aria-hidden="true"
    >
      <td><div class="skeleton-box box-16 skeleton-shimmer"></div></td>
      <td><div class="skeleton-box box-40 skeleton-shimmer"></div></td>
      <td>
        <div class="skeleton-line line-60 skeleton-shimmer"></div>
        <div class="skeleton-line line-85 skeleton-shimmer" style="margin-top: 4px;"></div>
      </td>
      <td><div class="skeleton-line line-40 skeleton-shimmer"></div></td>
      <td><div class="skeleton-line line-60 skeleton-shimmer"></div></td>
      <td><div class="skeleton-box box-stepper skeleton-shimmer"></div></td>
      <td><div class="skeleton-box box-btn skeleton-shimmer"></div></td>
    </tr>
  </template>

  <template v-else-if="type === 'stack'">
    <div
      v-for="i in count"
      :key="i"
      class="skeleton-stack"
      aria-hidden="true"
    >
      <div class="skeleton-box box-52 skeleton-shimmer"></div>
      <div class="skeleton-stack-body">
        <div class="skeleton-line line-60 skeleton-shimmer"></div>
        <div class="skeleton-line line-85 skeleton-shimmer"></div>
        <div class="skeleton-line line-40 skeleton-shimmer"></div>
      </div>
      <div class="skeleton-box box-stepper-md skeleton-shimmer"></div>
    </div>
  </template>
</template>

<script setup>
defineProps({
  type: {
    type: String,
    default: 'card',
    validator: (v) => ['card', 'row', 'stack'].includes(v)
  },
  count: {
    type: Number,
    default: 1
  }
});
</script>

<style scoped>
/* シマー効果ベース */
.skeleton-shimmer {
  position: relative;
  overflow: hidden;
  background: var(--skeleton);
  border-radius: var(--radius-sm);
}

.skeleton-shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--skeleton-hi) 50%,
    transparent 100%
  );
  animation: shimmer 1.2s infinite;
}

@keyframes shimmer {
  100% {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-shimmer::after {
    animation: none;
  }
}

/* card 型 */
.skeleton-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.skeleton-photo {
  aspect-ratio: 4 / 3;
  width: 100%;
  border-radius: 0;
}

.skeleton-body {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.skeleton-line {
  height: 12px;
}

.line-60 { width: 60%; }
.line-85 { width: 85%; }
.line-40 { width: 40%; }

.skeleton-bar {
  height: 3px;
  width: 100%;
  margin-top: var(--space-1);
}

.skeleton-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--space-2);
}

.skeleton-qr {
  width: 60px;
  height: 14px;
}

.skeleton-stepper {
  width: 80px;
  height: 28px;
  border-radius: var(--radius-md);
}

/* row 型 (table) */
.skeleton-row td {
  padding: var(--space-3) var(--space-2);
  border-bottom: 1px solid var(--border);
}

.box-16 { width: 16px; height: 16px; }
.box-40 { width: 40px; height: 40px; border-radius: var(--radius-sm); }
.box-stepper { width: 84px; height: 28px; border-radius: var(--radius-md); }
.box-btn { width: 40px; height: 28px; border-radius: var(--radius-sm); }

/* stack 型 (mobile) */
.skeleton-stack {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.box-52 { width: 52px; height: 52px; border-radius: var(--radius-sm); flex-shrink: 0; }
.skeleton-stack-body { flex: 1; display: flex; flex-direction: column; gap: var(--space-1); }
.box-stepper-md { width: 110px; height: 44px; border-radius: var(--radius-md); flex-shrink: 0; }
</style>
