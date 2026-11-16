<script setup>
// 排行 Top 30：有访问统计按热度，否则降级为缓存占用（真实环境无访问统计）
import { computed } from 'vue'
import { Trophy } from '@element-plus/icons-vue'
import PkgLogo from './PkgLogo.vue'
import { fmtSize } from '../store'
const props = defineProps({
  top30: { type: Array, default: () => [] },
  top30By: { type: String, default: 'visits' },
})
const emit = defineEmits(['open'])
// 包列表异步到位，props 快照会让排行在首帧后永远空白，必须保持响应式
const isVisits = computed(() => props.top30By === 'visits')
// 运行时 props 无法表达元素结构，用 JSDoc 收紧为 PackageInfo & {heat}（mock 榜单携带热度字段）
const items = computed(() => /** @type {Array<import('../types.js').PackageInfo & {heat?: number}>} */ (props.top30))
</script>

<template>
  <div class="top30">
    <div class="top30-head">
      <div class="t"><el-icon class="ico" :size="16"><Trophy /></el-icon>{{ isVisits ? '访问次数 Top 20' : '缓存占用 Top 20' }}<span class="tag ign">{{ isVisits ? '按热度排序' : '按占用空间排序' }}</span></div>
    </div>
    <div class="tbl-scroll">
      <table class="rank-tbl">
        <thead>
          <tr>
            <th style="width: 70px">排名</th>
            <th>包名</th>
            <th style="width: 130px">{{ isVisits ? '访问次数' : '占用空间' }}</th>
            <th>描述</th>
            <th v-if="isVisits">热度</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in items" :key="p.name" class="rank-row" @click="emit('open', p)">
            <td>
              <span class="rank-no" :class="i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''">{{ i + 1 }}</span>
            </td>
            <td>
              <span class="rank-pkg">
                <PkgLogo :name="p.name" :size="30" :homepage="p.homepage" />
                <span class="nm">
                  <span v-if="p.name.includes('/')" class="scope">{{ p.name.slice(0, p.name.lastIndexOf('/') + 1) }}</span>{{ p.name.split('/').pop() }}
                </span>
                <span v-if="p.origin === 'private'" class="origin-badge prv" title="私有包">私有包</span>
                <span v-else-if="p.origin === 'proxy'" class="origin-badge proxy" title="缓存包">缓存包</span>
              </span>
            </td>
            <td><span class="rank-visit">{{ isVisits ? (p.visits || 0).toLocaleString() : fmtSize(p.size) }}</span></td>
            <td><span class="rank-desc" :title="p.description || ''">{{ p.description || '—' }}</span></td>
            <td v-if="isVisits">
              <div class="heat" title="访问热度占比">
                <div class="heat-bar"><i :style="{ width: p.heat + '%' }"></i></div>
                <span class="heat-pct">{{ p.heat }}%</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.top30 {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  overflow: hidden;
  margin-bottom: 26px;
  animation: fadeUp .2s both;
}
.top30-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 20px;
  border-bottom: 1px solid var(--line);
}
.t { display: flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 600; }
.t .ico { color: var(--acc); }
.tbl-scroll { overflow-x: auto; }
.rank-tbl { width: 100%; border-collapse: collapse; min-width: 560px; }
.rank-tbl th {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-faint);
  text-align: left;
  padding: 10px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--panel-soft);
  white-space: nowrap;
}
.rank-tbl td {
  padding: 10px 20px;
  font-size: 13px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: middle;
}
.rank-tbl tr:last-child td { border-bottom: none; }
.rank-tbl tr { transition: background .12s; }
.rank-tbl tr:hover { background: var(--panel-soft); }
.rank-tbl .rank-row { cursor: pointer; }
.rank-no {
  width: 26px;
  height: 26px;
  border-radius: var(--r-md);
  display: inline-grid;
  place-items: center;
  font-family: var(--num);
  font-weight: 600;
  font-size: 13px;
  background: var(--num-bg);
  color: var(--ink-dim);
}
.rank-no.gold { background: var(--acc-soft); color: var(--acc); border: 1px solid var(--acc-line); }
.rank-no.silver { background: var(--num-bg); color: var(--ink); border: 1px solid var(--line); }
.rank-no.bronze { background: var(--num-bg); color: var(--ink-dim); border: 1px solid var(--line); }
.rank-pkg { display: flex; align-items: center; gap: 10px; font-weight: 500; }
.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--num); }
.scope { color: var(--ink-faint); font-weight: 400; }
.origin-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  padding: 3px 7px;
  border-radius: 3px;
  border: 1px solid;
}
.origin-badge.prv { color: var(--acc); background: var(--acc-soft); border-color: var(--acc-line); }
.origin-badge.proxy { color: var(--inf); background: var(--inf-soft); border-color: var(--inf-line); }
.rank-visit { font-family: var(--num); font-weight: 600; font-size: 13.5px; color: var(--ink); font-variant-numeric: tabular-nums; }
.rank-desc {
  display: block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-dim);
  font-size: 12.5px;
}
.heat { display: flex; align-items: center; gap: 12px; min-width: 180px; }
.heat-bar { flex: 1; height: 6px; border-radius: 99px; background: var(--num-bg-2); overflow: hidden; }
.heat-bar i {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: var(--pri);
}
.heat-pct { font-family: var(--num); font-size: 11.5px; color: var(--ink-faint); width: 34px; text-align: right; }

/* —— 移动端：隐藏「热度」列，缩小 padding —— */
@media (max-width: 767px) {
  .top30-head { padding: 12px 14px; }
  .t { font-size: 13px; gap: 8px; }
  .t .ico { font-size: 16px; }
  .rank-tbl { min-width: 320px; }
  .rank-tbl th, .rank-tbl td { padding: 9px 14px; font-size: 12px; }
  .rank-tbl th:nth-child(4), .rank-tbl td:nth-child(4),
  .rank-tbl th:nth-child(5), .rank-tbl td:nth-child(5) { display: none; } /* 隐藏描述列与热度列 */
  .rank-no { width: 26px; height: 26px; font-size: 12px; border-radius: 8px; }
  .rank-pkg { gap: 7px; font-size: 12.5px; }
  .rank-visit { font-size: 13px; }
  .heat { display: none; }
}
</style>
