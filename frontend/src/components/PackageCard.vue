<script setup>
import StatusTag from './StatusTag.vue'
import PkgLogo from './PkgLogo.vue'
import { fmtSize } from '../store'

defineProps({
  pkg: { type: Object, required: true },
  threshold: { type: Number, default: 15 },
})
const emit = defineEmits(['open', 'clean', 'ignore', 'unignore'])

function splitName(name) {
  const i = name.lastIndexOf('/')
  if (i > 0) return { scope: name.slice(0, i + 1), base: name.slice(i + 1) }
  return { scope: '', base: name }
}
</script>

<template>
  <div
    class="pkg-card"
    :class="{ warn: pkg.status === 'warn', ignored: pkg.status === 'ignored', broken: pkg.status === 'broken' }"
    @click="emit('open', pkg)"
  >
    <div class="p-top">
      <PkgLogo :name="pkg.name" :size="44" :homepage="pkg.homepage" />
      <div style="flex: 1; min-width: 0">
        <div class="pkg-name">
          <span class="nm">
            <span v-if="splitName(pkg.name).scope" class="scope">{{ splitName(pkg.name).scope }}</span>{{ splitName(pkg.name).base }}
          </span>
          <StatusTag :status="pkg.status" />
        </div>
        <div v-if="pkg.status === 'warn'" class="warn-tip">超阈值 {{ pkg.versions - threshold }} 个版本</div>
        <div v-else-if="pkg.status === 'broken'" class="warn-tip">元数据异常，不影响其他包</div>
        <div v-else class="warn-tip">&nbsp;</div>
      </div>
    </div>
    <div class="p-meta">
      <div class="m-item">
        <div class="m-v">{{ pkg.versions }}</div>
        <div class="m-l">版本数</div>
      </div>
      <div class="m-item">
        <div class="m-v">{{ fmtSize(pkg.size) }}</div>
        <div class="m-l">占用空间</div>
      </div>
    </div>
    <div class="p-ops" @click.stop>
      <template v-if="pkg.status === 'warn'">
        <button class="btn clean" @click="emit('clean', pkg)">清理</button>
        <button class="btn ignore" @click="emit('ignore', pkg)">忽略</button>
      </template>
      <template v-else-if="pkg.status === 'ignored'">
        <button class="btn unignore" @click="emit('unignore', pkg)">取消忽略</button>
      </template>
      <template v-else-if="pkg.status === 'broken'">
        <button class="btn unignore" @click="emit('open', pkg)">查看</button>
      </template>
      <template v-else>
        <button class="btn ignore" @click="emit('ignore', pkg)">忽略</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pkg-card {
  position: relative;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 18px 20px;
  box-shadow: var(--shadow);
  transition: box-shadow .15s;
  animation: fadeUp .2s both;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 168px;
  cursor: pointer;
}
.pkg-card:hover { box-shadow: var(--shadow-hover); }
.pkg-card.warn {
  border-color: var(--warn-line);
}
.pkg-card.ignored { background: var(--ignored-card); opacity: .82; }
.pkg-card.broken { border-style: dashed; }
.p-top { display: flex; align-items: center; gap: 12px; }
.pkg-name {
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.pkg-name .nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  font-family: var(--num);
}
.pkg-name .scope { color: var(--ink-faint); font-weight: 400; }
.warn-tip {
  font-size: 11.5px;
  color: var(--ink-faint);
  margin-top: 3px;
  min-height: 15px;
}
.pkg-card.warn .warn-tip { color: var(--warn); font-weight: 500; }
.p-meta {
  display: flex;
  gap: 18px;
  margin: 14px 0 15px;
  padding: 11px 0;
  border-top: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
}
.m-item .m-v { font-family: var(--num); font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
.m-item .m-l { font-size: 11px; color: var(--ink-faint); margin-top: 2px; }
.pkg-card.warn .m-item .m-v { color: var(--warn); }
.p-ops { margin-top: auto; display: flex; align-items: center; gap: 9px; }
</style>
