import { createRouter, createWebHistory } from 'vue-router'
// 小 Verdaccio Mate 仅 6 个页面，直接同步导入（无需代码分割）
import LoginView from '../views/LoginView.vue'
import OverviewView from '../views/OverviewView.vue'
import SearchView from '../views/SearchView.vue'
import LogsView from '../views/LogsView.vue'
import TopListView from '../views/TopListView.vue'
import NotificationsView from '../views/NotificationsView.vue'
import AboutView from '../views/AboutView.vue'
import UsersView from '../views/UsersView.vue'
import { storage } from '../utils/storage'

/** @type {import('vue-router').RouteRecordRaw[]} */
const routes = [
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  { path: '/', name: 'overview', component: OverviewView },
  { path: '/search', name: 'search', component: SearchView },
  { path: '/logs', name: 'logs', component: LogsView },
  { path: '/toplist', name: 'toplist', component: TopListView },
  { path: '/notifications', name: 'notifications', component: NotificationsView },
  { path: '/about', name: 'about', component: AboutView },
  { path: '/users', name: 'users', component: UsersView },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

router.beforeEach((to) => {
  const logged = storage.get('vcm-token') !== null || storage.getSession('vcm-token') !== null
  if (!to.meta.public && !logged) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && logged) {
    return { name: 'overview' }
  }
})

export default router
