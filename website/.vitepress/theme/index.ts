import DefaultTheme from 'vitepress/theme'
import ShotStrip from './components/ShotStrip.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ShotStrip', ShotStrip)
  }
}
