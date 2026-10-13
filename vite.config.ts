import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
const base = process.env.BASE_PATH || '/';
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error('BASE_PATH must be an absolute directory path ending in /');
export default defineConfig({base,plugins:[react()],server:{host:'0.0.0.0',port:5173,strictPort:true,headers},preview:{host:'0.0.0.0',port:4173,headers},build:{target:'es2022',chunkSizeWarningLimit:800}});
