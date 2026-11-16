<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useTheme } from '../composables/useTheme'
import api from '../api'
import { notifyError } from '../utils/notify.js'
import { Sunny, Moon, User, Key, View, Hide } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const router = useRouter()
const route = useRoute()
const { theme, toggle } = useTheme()

const username = ref('admin')
const password = ref('666666')
const remember = ref(true)
const loading = ref(false)
const showPwd = ref(false)

async function login() {
  if (!username.value.trim() || !password.value) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  loading.value = true
  let res
  try {
    res = await api.login(username.value.trim(), password.value, remember.value)
  } catch (e) {
    notifyError(e, '登录失败，请稍后重试') // 超时/断网：不能卡在 loading 态，否则按钮一直转圈
    return
  } finally {
    loading.value = false
  }
  if (!res.ok) {
    ElMessage.error(res.message || '用户名或密码错误')
    return
  }
  ElMessage.success('欢迎回来')
  // route.query.redirect 归一：数组形式取首项，缺省回首页
  const redirect = Array.isArray(route.query.redirect) ? route.query.redirect[0] : route.query.redirect
  router.push(redirect || '/')
}
</script>

<template>
  <div class="login-page">
    <button class="theme-toggle" @click="toggle">
      <el-icon v-if="theme === 'dark'"><Sunny /></el-icon>
      <el-icon v-else><Moon /></el-icon>{{ theme === 'dark' ? '亮色' : '暗色' }}
    </button>

    <div class="login-card">
      <div class="login-logo"><img class="login-logo-img" src="/logo.svg" alt="Verdaccio Mate" /></div>
      <div class="login-title">Verdaccio Mate</div>
      <div class="login-sub">原版 Verdaccio 的得力伙伴 · 缓存与私有包尽在掌握</div>

      <div class="field">
        <el-icon class="f-ico"><User /></el-icon>
        <input v-model="username" type="text" placeholder="用户名 / 邮箱" @keyup.enter="login" />
      </div>
      <div class="field">
        <el-icon class="f-ico"><Key /></el-icon>
        <input v-model="password" :type="showPwd ? 'text' : 'password'" placeholder="密码" @keyup.enter="login" />
        <button
          class="pwd-eye"
          type="button"
          :title="showPwd ? '隐藏密码' : '显示密码'"
          :aria-label="showPwd ? '隐藏密码' : '显示密码'"
          @click="showPwd = !showPwd"
        ><el-icon><component :is="showPwd ? Hide : View" /></el-icon></button>
      </div>

      <div class="login-options">
        <label class="remember">
          <input v-model="remember" type="checkbox" />
          <span>记住我</span>
        </label>
        <a class="forgot">忘记密码？</a>
      </div>

      <button class="login-btn" :disabled="loading" @click="login">
        {{ loading ? '登录中…' : '登 录' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--bg);
  overflow: hidden;
}
.theme-toggle {
  position: absolute;
  top: 22px;
  right: 22px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1.5px solid var(--line);
  background: var(--card);
  color: var(--ink-dim);
  font-size: 12.5px;
  font-weight: 600;
  padding: 8px 15px;
  border-radius: var(--r-md);
  cursor: pointer;
  transition: .16s;
}
.theme-toggle:hover { border-color: var(--acc); color: var(--acc); }

.login-card {
  position: relative;
  z-index: 2;
  width: 420px;
  max-width: 92vw;
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: 0 16px 40px -24px rgba(0, 0, 0, .4);
  padding: 42px 40px 34px;
  text-align: center;
  animation: fadeUp .2s both;
}
.login-logo {
  width: 62px;
  height: 62px;
  margin: 0 auto 16px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  overflow: hidden;
}
.login-logo-img {
  width: 62px;
  height: 62px;
  display: block;
  border-radius: var(--r-md);
}
.login-title {
  font-size: 19px;
  font-weight: 600;
  color: var(--acc);
  letter-spacing: -.3px;
}
.login-sub { font-size: 12.5px; color: var(--ink-faint); margin: 5px 0 26px; }

.field {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--card);
  border: 1.5px solid var(--line);
  border-radius: var(--r-md);
  padding: 0 16px;
  height: 50px;
  margin-bottom: 14px;
  transition: .18s;
}
.field:focus-within { border-color: var(--pri); box-shadow: 0 0 0 3px var(--line-soft); }
.f-ico { font-size: 16px; color: var(--ink-faint); flex-shrink: 0; }
.field input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  font-family: var(--sans);
  color: var(--ink);
}
.field input::placeholder { color: var(--ink-faint); }
.pwd-eye {
  flex: none;
  border: none;
  background: transparent;
  padding: 4px;
  margin-right: -4px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  color: var(--ink-faint);
  transition: color .16s;
}
.pwd-eye:hover { color: var(--acc); }

.login-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 4px 2px 20px;
  font-size: 12.5px;
}
.remember { display: flex; align-items: center; gap: 7px; color: var(--ink-dim); cursor: pointer; }
.remember input { accent-color: var(--acc); width: 15px; height: 15px; cursor: pointer; }
.forgot { color: var(--acc); cursor: pointer; }
.forgot:hover { text-decoration: underline; }

.login-btn {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: var(--r-md);
  cursor: pointer;
  background: var(--pri);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  font-family: var(--sans);
  transition: background .18s;
}
html.dark .login-btn { color: #141414; }
.login-btn:hover { background: var(--pri-h); }
.login-btn:disabled { opacity: .6; cursor: not-allowed; }
</style>
