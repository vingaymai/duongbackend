// duongbackend/app.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path'); // Import module 'path'

// Import Auth Controller và Auth Middleware
const authController = require('./controllers/authController');
const { protect } = require('./middleware/authMiddleware');
const { authorize } = require('./middleware/authorizeMiddleware');

// Import các Router
const userRoutes = require('./routes/userRoutes');
const roleRoutes = require('./routes/roleRoutes');
const permissionRoutes = require('./routes/permissionRoutes');
const branchRoutes = require('./routes/branchRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes'); // <-- tồn kho
const customerRoutes = require('./routes/customerRoutes'); //khach haàng
const salesRoutes = require('./routes/salesRoutes');
const statisticsRoutes = require('./routes/statisticsRoutes');
const app = express(); // Khởi tạo ứng dụng Express
const orderManagementRoutes = require('./routes/orderManagementRoutes'); //đơn hàng
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 200
}));
app.use(express.json());

// Middleware để phục vụ các file tĩnh (ảnh upload)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


app.get('/', (req, res) => {
    res.send('Welcome to the Library App Backend!');
});

// Routes Xác thực (Auth Routes)
app.post('/api/auth/register', authController.register);
app.post('/api/auth/login', authController.login);
app.get('/api/auth/me', protect, authController.getMe);

// Các API routes khác, được bảo vệ bằng JWT và middleware phân quyền
app.use('/api/users', protect, userRoutes);
app.use('/api/roles', protect, roleRoutes);
app.use('/api/permissions', protect, permissionRoutes);
app.use('/api/branches', protect, branchRoutes);
app.use('/api/products', protect, productRoutes);
app.use('/api/categories', protect, categoryRoutes);
app.use('/api/inventory', inventoryRoutes); // <-- tồn kho
app.use('/api/customers', customerRoutes); //khach haàng
app.use('/api/sales', salesRoutes); // Thêm dòng này
app.use('/api/orders-management', protect, orderManagementRoutes);
app.use('/api/statistics', statisticsRoutes); //thống kê
// Xử lý lỗi 404
app.use((req, res, next) => {
    console.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Không tìm thấy tài nguyên' });
});

// Xử lý lỗi chung
app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err.stack);
    res.status(err.statusCode || 500).json({
        message: err.message || 'Đã xảy ra lỗi server',
        error: process.env.NODE_ENV === 'development' ? err.stack : {}
    });
});

// EXPORT instance 'app' để server.js có thể import và sử dụng
module.exports = app;
