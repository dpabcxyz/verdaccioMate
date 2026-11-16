<script setup>
// 核心统计卡 Stat1：图标 + 数字 + 标签；语义色仅用于小面积点缀
import OriginSplit from './OriginSplit.vue'
defineProps({
  tone: { type: String, default: 'green' }, // green | warn | dgr | inf
  label: { type: String, required: true },
  value: { type: String, required: true },
  unit: { type: String, default: '' },
  icon: { type: [Object, Function], default: null },
  cta: { type: String, default: '' },
  split: { type: Array, default: null }, // 私有/缓存拆分（OriginSplit）
})
const emit = defineEmits(['cta'])
</script>

<template>
  <div class="stat1" :class="`t-${tone}`">
    <div class="top">
      <span class="label">{{ label }}</span>
      <span v-if="icon" class="ico"><el-icon :size="18"><component :is="icon" /></el-icon></span>
    </div>
    <div class="value">
      {{ value }}<span v-if="unit" class="unit">{{ unit }}</span>
    </div>
    <OriginSplit v-if="split && split.length" :parts="split" />
    <button v-if="cta" class="cta" @click="emit('cta')">{{ cta }}</button>
  </div>
</template>

<style scoped>
.stat1 {
  position: relative;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 18px 20px;
  box-shadow: var(--shadow);
  animation: fadeUp .2s both;
  overflow: hidden;
  transition: box-shadow .15s;
  min-height: 118px;
}
.stat1:hover { box-shadow: var(--shadow-hover); }
.stat1 .top { display: flex; align-items: center; justify-content: space-between; }
.stat1 .ico {
  width: 30px;
  height: 30px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  background: var(--tone-soft);
  color: var(--tone);
}
.stat1 .label { font-size: 13px; color: var(--ink-dim); }
.stat1 .value {
  font-family: var(--num);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -.5px;
  color: var(--ink);
  line-height: 1.1;
  margin-top: 12px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}
.stat1 .value .unit { font-size: 13px; color: var(--ink-faint); font-weight: 400; }
.stat1.t-green { --tone: var(--suc-deep); --tone-soft: var(--suc-soft); }
.stat1.t-warn { --tone: var(--warn); --tone-soft: var(--warn-soft); }
.stat1.t-dgr { --tone: var(--dgr); --tone-soft: var(--dgr-soft); }
.stat1.t-inf { --tone: var(--inf); --tone-soft: var(--inf-soft); }
.stat1 .cta {
  position: absolute;
  right: 18px;
  bottom: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--pri);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background .12s;
  z-index: 2;
  border: none;
  font-family: var(--sans);
}
html.dark .stat1 .cta { color: #141414; }
.stat1 .cta:hover { background: var(--pri-h); }

@media (max-width: 767px) {
  .stat1 { padding: 13px 15px; min-height: 0; }
  .stat1 .value { font-size: 22px; margin-top: 8px; }
  .stat1 .cta { position: static; margin-top: 10px; font-size: 11.5px; padding: 5px 12px; }
}
</style>
