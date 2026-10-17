import axios from 'axios';
import { installApiTokenInterceptors } from './utils/apiTokenInterceptors.js';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
});

installApiTokenInterceptors(api);

export default api;

