<script setup>
// 辅助指标小卡 Stat2：轻量卡，顶部 3px 语义色条
import OriginSplit from './OriginSplit.vue'
defineProps({
  tone: { type: String, default: 'inf' }, // inf | suc | warn | acc
  label: { type: String, required: true },
  icon: { type: [Object, Function], default: null },
  main: { type: String, required: true },
  unit: { type: String, default: '' },
  sub: { type: String, default: '' },
  link: { type: String, default: '' },
  split: { type: Array, default: null }, // 私有/缓存拆分（OriginSplit）
})
const emit = defineEmits(['link'])
</script>

<template>
  <div class="stat2" :class="`c-${tone}`" @click="link && emit('link')">
    <div class="s2-top">
      <el-icon v-if="icon" class="ico2"><component :is="icon" /></el-icon>{{ label }}
      <span v-if="link" class="link" @click.stop="emit('link')">{{ link }}</span>
    </div>
    <div class="s2-val">
      <span class="main">{{ main }}</span><span v-if="unit" class="u">{{ unit }}</span>
    </div>
    <div v-if="sub" class="s2-sub">{{ sub }}</div>
    <OriginSplit v-if="split && split.length" :parts="split" />
  </div>
</template>

<style scoped>
.stat2 {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 14px 16px;
  box-shadow: var(--shadow);
  cursor: pointer;
  animation: fadeUp .2s both;
  transition: box-shadow .15s;
}
.stat2:hover { box-shadow: var(--shadow-hover); }
.s2-top { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink-dim); }
.ico2 { font-size: 14px; color: var(--tone-c); }
.s2-val {
  font-family: var(--num);
  font-size: 19px;
  font-weight: 700;
  margin-top: 8px;
  color: var(--ink);
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.s2-val .main { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.s2-val .u { font-size: 11.5px; color: var(--ink-faint); font-weight: 400; }
.s2-sub { font-family: var(--num); font-size: 11px; color: var(--ink-faint); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link {
  font-size: 11.5px;
  margin-left: auto;
  color: var(--acc);
  cursor: pointer;
  flex-shrink: 0;
}
.link:hover { color: var(--acc-h); }
.stat2.c-inf { border-top: 3px solid var(--line); --tone-c: var(--inf); }
.stat2.c-suc { border-top: 3px solid var(--suc); --tone-c: var(--suc-deep); }
.stat2.c-warn { border-top: 3px solid var(--warn); --tone-c: var(--warn); }
.stat2.c-acc { border-top: 3px solid var(--acc); --tone-c: var(--acc); }

/* —— 移动端：压缩 padding 和字号，防止窄屏溢出 —— */
@media (max-width: 767px) {
  .stat2 { padding: 10px 12px; }
  .s2-top { font-size: 11.5px; gap: 6px; }
  .ico2 { font-size: 13px; }
  .s2-val { font-size: 16px; margin-top: 6px; }
  .s2-val .u { font-size: 10.5px; }
  .s2-sub { font-size: 10px; margin-top: 2px; }
  .link { font-size: 10.5px; }
}
</style>
