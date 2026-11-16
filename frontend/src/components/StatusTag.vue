<script setup>
// 状态标签：warn 预警 / ok 正常 / ignored 已忽略 / broken 异常
import { WarningFilled, CircleCheckFilled, Hide, WarnTriangleFilled } from '@element-plus/icons-vue'

const props = defineProps({
  status: { type: String, required: true }, // warn | ok | ignored | broken
})

const MAP = {
  warn: { cls: 'warn', text: '预警', icon: WarningFilled },
  ok: { cls: 'ok', text: '正常', icon: CircleCheckFilled },
  ignored: { cls: 'ign', text: '已忽略', icon: Hide },
  broken: { cls: 'broken', text: '异常', icon: WarnTriangleFilled },
}
</script>

<template>
  <span class="tag" :class="MAP[props.status]?.cls || 'ok'">
    <el-icon><component :is="MAP[props.status]?.icon || CircleCheckFilled" /></el-icon>{{ MAP[props.status]?.text }}
  </span>
</template>
