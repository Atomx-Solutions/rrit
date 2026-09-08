import type { InjectionKey, Ref } from 'vue'

export const dashboardKey: InjectionKey<{
  sidebarOpen: Ref<boolean>
  notificationsOpen: Ref<boolean>
}> = Symbol('dashboard')
