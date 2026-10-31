<template>
  <div class="purchases-view">
    <!-- ひも付け状態のタブ -->
    <div class="status-tabs" role="tablist" aria-label="ひも付けの状態">
      <button
        v-for="tab in STATUS_TABS"
        :key="tab.value"
        type="button"
        role="tab"
        class="status-tab"
        :class="{ active: linkStatus === tab.value }"
        :aria-selected="linkStatus === tab.value"
        @click="linkStatus = tab.value"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 絞り込み -->
    <div class="purchase-controls">
      <label class="search-label grow">
        <AppIcon name="search" size="14" class="search-icon" />
        <input
          v-model="searchQuery"
          type="search"
          placeholder="商品名・コード・注文番号で検索..."
          class="search-input"
        />
      </label>
      <select v-model="shop" class="filter-select" aria-label="店">
        <option value="">店: すべて</option>
        <option v-for="s in shops" :key="s.name" :value="s.name">{{ s.name }}（{{ s.count }}）</option>
      </select>
      <select v-model="currency" class="filter-select" aria-label="通貨">
        <option value="">通貨: すべて</option>
        <option v-for="c in currencyOptions" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-model="batchId" class="filter-select batch-select" aria-label="取り込みバッチ">
        <option value="">バッチ: すべて</option>
        <option v-for="b in batches" :key="b.id" :value="String(b.id)">{{ formatBatchLabel(b) }}</option>
      </select>
      <label class="date-field">
        <span class="date-label">開始</span>
        <input v-model="fromDate" type="date" class="date-input" aria-label="開始日" />
      </label>
      <label class="date-field">
        <span class="date-label">終了</span>
        <input v-model="toDate" type="date" class="date-input" aria-label="終了日" />
      </label>
    </div>

    <!-- 一括承認（候補ありのときだけ） -->
    <div v-if="bulkMode && items.length > 0" class="bulk-bar">
      <label class="check-label">
        <input type="checkbox" :checked="allSelected" @change="toggleAll($event.target.checked)" />
        <span>このページをすべて選択</span>
      </label>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="selectedIds.length === 0 || bulkBusy"
        @click="bulkApprove"
      >
        選択した候補を承認（{{ selectedIds.length }}件）
      </button>
    </div>

    <div v-if="loading" class="state-message">読み込み中...</div>
    <div v-else-if="error" class="state-message error">{{ error }}</div>
    <div v-else-if="items.length === 0" class="empty-state">
      <p class="empty-text">該当する購入履歴はありません</p>
    </div>

    <div v-else class="purchases-content">
      <!-- デスクトップ：テーブル -->
      <div class="purchases-table-wrap only-desktop">
        <table class="purchases-table">
          <thead>
            <tr>
              <th v-if="bulkMode" class="col-check" aria-label="選択"></th>
              <th>注文日</th>
              <th>店</th>
              <th>注文番号</th>
              <th>コード</th>
              <th>商品名</th>
              <th class="num">単価</th>
              <th class="num">数量</th>
              <th>部品</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" class="purchase-row">
              <td v-if="bulkMode" class="col-check">
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(item.id)"
                  :aria-label="`${item.name}を選択`"
                  @change="toggleOne(item.id, $event.target.checked)"
                />
              </td>
              <td class="col-meta mono">{{ item.purchased_at || '-' }}</td>
              <td class="col-meta">{{ item.shop || '-' }}</td>
              <td class="col-meta mono">{{ item.order_id || '-' }}</td>
              <td class="col-meta mono">{{ item.code || '-' }}</td>
              <td class="col-name">{{ item.name }}</td>
              <td class="num mono">{{ formatUnitPrice(item.unit_price, item.currency) }}</td>
              <td class="num mono">{{ item.quantity ?? '-' }}</td>
              <td class="col-part">
                <PurchasePartCell
                  :record="item"
                  :busy="isBusy(item.id)"
                  @open="openPart"
                  @pick="openPicker"
                  @unlink="unlink"
                  @approve="approve"
                  @reject="reject"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- モバイル：カード -->
      <div class="purchases-stack only-mobile">
        <article v-for="item in items" :key="item.id" class="purchase-card">
          <div class="card-head">
            <input
              v-if="bulkMode"
              type="checkbox"
              :checked="selectedIds.includes(item.id)"
              :aria-label="`${item.name}を選択`"
              @change="toggleOne(item.id, $event.target.checked)"
            />
            <h2 class="card-title">{{ item.name }}</h2>
          </div>
          <div class="card-meta">
            <span class="mono">{{ item.purchased_at || '-' }}</span>
            <span>·</span>
            <span>{{ item.shop || '-' }}</span>
            <span v-if="item.order_id">·</span>
            <span v-if="item.order_id" class="mono">{{ item.order_id }}</span>
          </div>
          <div class="card-meta">
            <span v-if="item.code" class="mono">{{ item.code }}</span>
            <span v-if="item.code">·</span>
            <span class="mono">{{ formatUnitPrice(item.unit_price, item.currency) }} × {{ item.quantity ?? '-' }}</span>
          </div>
          <PurchasePartCell
            :record="item"
            :busy="isBusy(item.id)"
            @open="openPart"
            @pick="openPicker"
            @unlink="unlink"
            @approve="approve"
            @reject="reject"
          />
        </article>
      </div>

      <!-- ページング -->
      <div class="pager">
        <span class="pager-range mono">全 {{ total }} 件中 {{ range.start }}〜{{ range.end }} 件</span>
        <div class="pager-buttons">
          <button type="button" class="btn btn-secondary btn-sm" :disabled="!pager.hasPrev" @click="goPage(-1)">前へ</button>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="!pager.hasNext" @click="goPage(1)">次へ</button>
        </div>
      </div>
    </div>

    <PartPickerModal
      v-if="pickerRecord"
      :record="pickerRecord"
      :saving="pickerSaving"
      @close="pickerRecord = null"
      @select="onPartPicked"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import api from '../api';
import { useToast } from '../composables/useToast';
import AppIcon from './ui/AppIcon.vue';
import PurchasePartCell from './purchases/PurchasePartCell.vue';
import PartPickerModal from './purchases/PartPickerModal.vue';
import {
  PAGE_SIZE,
  formatUnitPrice,
  formatBatchLabel,
  pageRange,
  pagerState,
  buildPurchaseParams,
  buildCurrencyOptions,
  buildLinkMessage,
  summarizeBulkApprove
} from '../utils/purchaseFormat.js';

const toast = useToast();
const emit = defineEmits(['edit']);

const STATUS_TABS = [
  { value: '', label: 'すべて' },
  { value: 'unlinked', label: '未ひも付け' },
  { value: 'suggested', label: '候補あり' },
  { value: 'linked', label: 'ひも付け済み' }
];

const items = ref([]);
const total = ref(0);
const offset = ref(0);
const loading = ref(true);
const error = ref(null);

const linkStatus = ref('');
const shop = ref('');
const currency = ref('');
const batchId = ref('');
const fromDate = ref('');
const toDate = ref('');
const searchQuery = ref('');

const shops = ref([]);
const batches = ref([]);
const seenCurrencies = ref([]);
const currencyOptions = computed(() => buildCurrencyOptions(seenCurrencies.value));

const selectedIds = ref([]);
const busyIds = ref([]);
const bulkBusy = ref(false);
const pickerRecord = ref(null);
const pickerSaving = ref(false);

const bulkMode = computed(() => linkStatus.value === 'suggested');
const allSelected = computed(
  () => items.value.length > 0 && items.value.every((i) => selectedIds.value.includes(i.id))
);
const range = computed(() => pageRange(total.value, offset.value, items.value.length));
const pager = computed(() => pagerState(total.value, offset.value, PAGE_SIZE));

const isBusy = (id) => bulkBusy.value || busyIds.value.includes(id);

const errorMessage = (err, fallback) => err.response?.data?.error || fallback;

// 古いレスポンスで新しい結果を上書きしないよう、最後の要求だけ採用する
let fetchSeq = 0;
const fetchItems = async () => {
  const seq = ++fetchSeq;
  loading.value = true;
  error.value = null;
  try {
    const params = buildPurchaseParams(
      {
        linkStatus: linkStatus.value,
        shop: shop.value,
        from: fromDate.value,
        to: toDate.value,
        currency: currency.value,
        search: searchQuery.value,
        batchId: batchId.value
      },
      offset.value,
      PAGE_SIZE
    );
    const res = await api.get('/purchases', { params });
    if (seq !== fetchSeq) return;
    // 最終ページの最後の1件を処理して空になったときは、1つ前のページへ戻る
    if (res.data.items.length === 0 && offset.value > 0 && res.data.total > 0) {
      offset.value = Math.max(0, Math.floor((res.data.total - 1) / PAGE_SIZE) * PAGE_SIZE);
      return fetchItems();
    }
    items.value = res.data.items;
    total.value = res.data.total;
    const seen = new Set(seenCurrencies.value);
    for (const i of items.value) if (i.currency) seen.add(i.currency);
    seenCurrencies.value = [...seen];
    const ids = new Set(items.value.map((i) => i.id));
    selectedIds.value = selectedIds.value.filter((id) => ids.has(id));
  } catch (err) {
    if (seq !== fetchSeq) return;
    console.error(err);
    error.value = errorMessage(err, '購入履歴の取得に失敗しました');
  } finally {
    if (seq === fetchSeq) loading.value = false;
  }
};

const fetchShops = async () => {
  try {
    const res = await api.get('/purchases/shops');
    shops.value = (res.data || []).filter((s) => s.name);
  } catch (err) {
    console.error(err);
  }
};

const fetchBatches = async () => {
  try {
    const res = await api.get('/purchases/batches');
    batches.value = res.data || [];
  } catch (err) {
    console.error(err);
  }
};

// 絞り込みを変えたら 1 ページ目に戻す
const resetAndFetch = () => {
  offset.value = 0;
  selectedIds.value = [];
  fetchItems();
};

watch([linkStatus, shop, currency, batchId, fromDate, toDate], resetAndFetch);

let searchTimer;
watch(searchQuery, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(resetAndFetch, 300);
});

onMounted(() => {
  fetchItems();
  fetchShops();
  fetchBatches();
});

onUnmounted(() => clearTimeout(searchTimer));

const goPage = (dir) => {
  const next = offset.value + dir * PAGE_SIZE;
  if (next < 0) return;
  offset.value = next;
  selectedIds.value = [];
  fetchItems();
};

const toggleOne = (id, checked) => {
  selectedIds.value = checked
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter((x) => x !== id);
};

const toggleAll = (checked) => {
  selectedIds.value = checked ? items.value.map((i) => i.id) : [];
};

// 1 行の操作中は同じ行のボタンを無効にする
const withBusy = async (id, task) => {
  busyIds.value = [...busyIds.value, id];
  try {
    return await task();
  } finally {
    busyIds.value = busyIds.value.filter((x) => x !== id);
  }
};

const approve = (item) =>
  withBusy(item.id, async () => {
    try {
      const res = await api.post(`/purchases/${item.id}/approve-suggestion`);
      toast.success(buildLinkMessage('候補を承認しました', res.data.part_updated));
      await fetchItems();
    } catch (err) {
      console.error(err);
      toast.error(errorMessage(err, '候補の承認に失敗しました'));
    }
  });

const reject = (item) =>
  withBusy(item.id, async () => {
    try {
      await api.post(`/purchases/${item.id}/reject-suggestion`);
      toast.success('候補を却下しました');
      await fetchItems();
    } catch (err) {
      console.error(err);
      toast.error(errorMessage(err, '候補の却下に失敗しました'));
    }
  });

const bulkApprove = async () => {
  if (selectedIds.value.length === 0) return;
  bulkBusy.value = true;
  try {
    const res = await api.post('/purchases/approve-suggestions', { ids: selectedIds.value });
    const { message, type } = summarizeBulkApprove(res.data);
    toast.show({ message, type });
    selectedIds.value = [];
    await fetchItems();
  } catch (err) {
    console.error(err);
    toast.error(errorMessage(err, '一括承認に失敗しました'));
  } finally {
    bulkBusy.value = false;
  }
};

const openPicker = (item) => {
  pickerRecord.value = item;
};

const onPartPicked = async (part) => {
  const item = pickerRecord.value;
  if (!item) return;
  pickerSaving.value = true;
  try {
    const res = await api.patch(`/purchases/${item.id}`, { part_id: part.id });
    toast.success(buildLinkMessage(`部品「${part.name}」にひも付けました`, res.data.part_updated));
    pickerRecord.value = null;
    await fetchItems();
  } catch (err) {
    console.error(err);
    toast.error(errorMessage(err, 'ひも付けに失敗しました'));
  } finally {
    pickerSaving.value = false;
  }
};

const unlink = (item) => {
  if (
    !confirm(
      `「${item.name}」の部品へのひも付けを解除しますか？\n部品側の購入先・購入日・単価は元に戻りません（必要なら手で直してください）。`
    )
  ) {
    return;
  }
  return withBusy(item.id, async () => {
    try {
      await api.patch(`/purchases/${item.id}`, { part_id: null });
      toast.success('ひも付けを解除しました');
      await fetchItems();
    } catch (err) {
      console.error(err);
      toast.error(errorMessage(err, 'ひも付けの解除に失敗しました'));
    }
  });
};

// 部品名のリンク: 部品を取得して既存の編集モーダルを開く
const openPart = (item) =>
  withBusy(item.id, async () => {
    try {
      const res = await api.get(`/parts/${item.part_id}`);
      emit('edit', res.data);
    } catch (err) {
      console.error(err);
      toast.error(errorMessage(err, '部品の取得に失敗しました'));
    }
  });

defineExpose({ fetchParts: fetchItems });
</script>

<style scoped>
.purchases-view {
  display: flex;
  flex-direction: column;
  padding: 16px 20px 32px;
  gap: var(--space-4);
}

.status-tabs {
  display: flex;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.status-tab {
  height: 30px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text-2);
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  cursor: pointer;
  transition: background-color var(--dur), color var(--dur);
}

.status-tab:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.status-tab.active {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-color: var(--accent);
  font-weight: 500;
}

.purchase-controls {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  align-items: center;
}

.search-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.search-label.grow {
  flex: 1;
  min-width: 220px;
}

.search-label:focus-within {
  border-color: var(--accent);
}

.search-icon {
  color: var(--text-3);
}

.search-input {
  flex: 1;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  outline: none;
}

.search-input::placeholder {
  color: var(--text-3);
}

.filter-select,
.date-input {
  height: 32px;
  padding: 0 var(--space-2);
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--fs-13);
}

.filter-select:focus,
.date-input:focus {
  border-color: var(--accent);
  outline: none;
}

.batch-select {
  max-width: 280px;
}

.date-field {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.date-label {
  font-size: var(--fs-12);
  color: var(--text-3);
}

.bulk-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.check-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-13);
  color: var(--text-2);
}

.state-message {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-3);
  font-size: var(--fs-13);
}

.state-message.error {
  color: var(--ng-fg);
}

.empty-state {
  display: flex;
  justify-content: center;
  padding: 80px 20px;
}

.empty-text {
  font-size: var(--fs-14);
  color: var(--text-2);
}

.purchases-table-wrap {
  overflow-x: auto;
}

.purchases-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.purchases-table th {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-strong);
  font-size: var(--fs-12);
  font-weight: 500;
  color: var(--text-3);
  white-space: nowrap;
}

.purchase-row td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  background: var(--surface);
  font-size: var(--fs-13);
}

.num {
  text-align: right;
  white-space: nowrap;
}

.col-check {
  width: 32px;
}

.col-meta {
  color: var(--text-2);
  font-size: var(--fs-12);
}

.col-name {
  color: var(--text);
  min-width: 200px;
  overflow-wrap: anywhere;
}

.col-part {
  min-width: 200px;
}

.purchases-stack {
  display: flex;
  flex-direction: column;
}

.purchase-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-2);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.card-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.card-title {
  margin: 0;
  font-size: var(--fs-13);
  font-weight: 500;
  color: var(--text);
  overflow-wrap: anywhere;
}

.card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-11);
  color: var(--text-3);
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: var(--space-3);
}

.pager-range {
  font-size: var(--fs-12);
  color: var(--text-3);
}

.pager-buttons {
  display: flex;
  gap: var(--space-2);
}
</style>
