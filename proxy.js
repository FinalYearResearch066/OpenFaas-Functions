const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();

// 1. CORS allow කරනවා (මෙතනදී තමයි අර error එක නැති වෙන්නේ)
app.use(cors());

// 2. Browser එකෙන් එන ඕනෑම request එකක් OpenFaaS වලට pass කරනවා
app.use('/function', createProxyMiddleware({
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
}));

app.listen(3000, () => {
    console.log('Proxy server running on http://localhost:3000');
});