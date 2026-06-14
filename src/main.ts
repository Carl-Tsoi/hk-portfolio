import { createApp } from 'vue';
import App from './App.vue';
import './uni-polyfill';

const app = createApp(App);
app.mount('#app');
