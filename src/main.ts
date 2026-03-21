import './style.css'
import { initApp } from './app'

const root = document.querySelector<HTMLElement>('#app')

if (!root) {
  throw new Error('App root element not found.')
}

initApp(root)
