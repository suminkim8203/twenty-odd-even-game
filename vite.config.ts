import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/twenty-odd-even-game/',
  plugins: [react()],
})
