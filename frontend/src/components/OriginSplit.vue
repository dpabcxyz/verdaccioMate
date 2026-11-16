<script setup>
// 双源拆分条：私有包 / 缓存包 的分段比例条 + 图例
import { computed } from 'vue'
const props = defineProps({
  parts: { type: Array, required: true }, // [{ label, value, pct, tone }] tone: 'private' | 'proxy'
})
// 运行时 props 无法表达元素结构，用 JSDoc 收紧后供模板遍历
const segs = computed(() => /** @type {Array<{label: string, value: string, pct: number, tone: string}>} */ (props.parts))
</script>

<template>
  <div class="osplit">
    <div class="osplit-bar">
      <span
        v-for="(p, i) in segs"
        :key="i"
        class="osplit-seg"
        :class="`t-${p.tone}`"
        :style="{ width: p.pct + '%' }"
      ></span>
    </div>
    <div class="osplit-legend">
      <span v-for="(p, i) in segs" :key="i" class="osplit-item">
        <i class="osplit-dot" :class="`t-${p.tone}`"></i>{{ p.label }}<b v-if="p.value">{{ p.value }}</b>
      </span>
    </div>
  </div>
</template>

<style scoped>
.osplit { margin-top: 12px; }
.osplit-bar {
  display: flex;
  height: 7px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--line);
}
.osplit-seg { display: block; height: 100%; }
.osplit-seg.t-private { background: var(--pri); }
.osplit-seg.t-proxy { background: var(--inf); }
.osplit-seg.t-orange { background: var(--acc); }
.osplit-seg.t-purple { background: var(--inf); }
.osplit-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin-top: 9px;
  font-size: 12px;
  color: var(--ink-dim);
  font-weight: 500;
}
.osplit-item { display: inline-flex; align-items: center; gap: 6px; }
.osplit-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.osplit-dot.t-private { background: var(--pri); }
.osplit-dot.t-proxy { background: var(--inf); }
.osplit-dot.t-orange { background: var(--acc); }
.osplit-dot.t-purple { background: var(--inf); }
.osplit-item b { font-family: var(--num); color: var(--ink); font-weight: 700; }

@media (max-width: 767px) {
  .osplit { margin-top: 10px; }
  .osplit-legend { gap: 6px 12px; font-size: 11px; }
}
</style>