import { ref, watch } from 'vue';

const read = (k, d, allowed) => {
  try {
    const v = localStorage.getItem(k);
    return allowed.includes(v) ? v : d;
  } catch {
    return d;
  }
};

const query = ref('');            // 検索欄の入力値（そのまま）
const debouncedQuery = ref('');   // 250ms 後に反映される値。fetch に使う
const categoryId = ref('');       // '' = すべて、'none' = 未分類（クライアント側で絞り込み）
const locationId = ref('');
const tagId = ref('');
const sort = ref('id');           // id | name | part_number | category | location | quantity
const order = ref('desc');
const viewMode = ref(read('epm_view_mode', 'grid', ['grid', 'list']));
const gridSize = ref(read('epm_grid_size', 'medium', ['small', 'medium', 'large']));

let t = null;
watch(query, (v) => {
  clearTimeout(t);
  t = setTimeout(() => {
    debouncedQuery.value = v;
  }, 250);
});

watch(viewMode, (v) => {
  try {
    localStorage.setItem('epm_view_mode', v);
  } catch {}
});

watch(gridSize, (v) => {
  try {
    localStorage.setItem('epm_grid_size', v);
  } catch {}
});

export function usePartsFilters() {
  const clearAll = () => {
    categoryId.value = '';
    locationId.value = '';
    tagId.value = '';
    query.value = '';
  };

  return {
    query,
    debouncedQuery,
    categoryId,
    locationId,
    tagId,
    sort,
    order,
    viewMode,
    gridSize,
    clearAll
  };
}
