<script setup>
defineProps({
  type: {
    type: String,
    default: 'grid' // 'grid' | 'list'
  },
  count: {
    type: Number,
    default: 1
  }
});
</script>

<template>
  <template v-if="type === 'grid'">
    <div v-for="n in count" :key="n" class="skeleton-card glass-panel">
      <div class="skeleton-image shimmer"></div>
      <div class="skeleton-content">
        <div class="skeleton-line title shimmer"></div>
        <div class="skeleton-line subtitle shimmer"></div>
        <div class="skeleton-row">
          <div class="skeleton-badge shimmer"></div>
          <div class="skeleton-badge small shimmer"></div>
        </div>
      </div>
    </div>
  </template>

  <template v-else>
    <tr v-for="n in count" :key="n" class="skeleton-row-tr">
      <td class="col-check"><div class="skeleton-box sm shimmer"></div></td>
      <td class="col-img"><div class="skeleton-box md shimmer"></div></td>
      <td class="col-name"><div class="skeleton-line title shimmer"></div></td>
      <td class="col-pn"><div class="skeleton-line subtitle shimmer"></div></td>
      <td class="col-cat"><div class="skeleton-badge shimmer"></div></td>
      <td class="col-loc"><div class="skeleton-badge shimmer"></div></td>
      <td class="col-qty"><div class="skeleton-box sm shimmer"></div></td>
      <td class="col-act"><div class="skeleton-box sm shimmer"></div></td>
    </tr>
  </template>
</template>

<style scoped>
.skeleton-card {
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 1rem;
  gap: 0.75rem;
}

.skeleton-image {
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 12px;
}

.skeleton-content {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 0.25rem;
}

.skeleton-line {
  height: 14px;
  border-radius: 6px;
}

.skeleton-line.title {
  width: 75%;
  height: 18px;
}

.skeleton-line.subtitle {
  width: 45%;
}

.skeleton-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.skeleton-badge {
  height: 22px;
  width: 60px;
  border-radius: 6px;
}

.skeleton-badge.small {
  width: 40px;
}

/* リストテーブル用 */
.skeleton-row-tr td {
  padding: 0.85rem 0.5rem;
  border-bottom: 1px solid var(--border-color);
}

.skeleton-box {
  border-radius: 6px;
}

.skeleton-box.sm {
  width: 24px;
  height: 24px;
}

.skeleton-box.md {
  width: 42px;
  height: 42px;
  border-radius: 8px;
}

/* シマー（波紋アニメーション） */
.shimmer {
  background: var(--bg-hover);
  position: relative;
  overflow: hidden;
}

.shimmer::after {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  transform: translateX(-100%);
  background-image: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0,
    rgba(255, 255, 255, 0.08) 20%,
    rgba(255, 255, 255, 0.18) 60%,
    rgba(255, 255, 255, 0)
  );
  animation: shimmer 1.6s infinite;
}

[data-theme="light"] .shimmer::after {
  background-image: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0) 0,
    rgba(0, 0, 0, 0.03) 20%,
    rgba(0, 0, 0, 0.07) 60%,
    rgba(0, 0, 0, 0)
  );
}

@keyframes shimmer {
  100% {
    transform: translateX(100%);
  }
}
</style>
