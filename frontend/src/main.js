import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/base.css'
import { initTheme } from './composables/useTheme'

// 主题：按存储状态 + 日出日落自动判定后应用，避免首帧闪烁
initTheme()

const app = createApp(App)
app.use(router)
app.mount('#app')
