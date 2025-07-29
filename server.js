// duongbackend/server.js

require('dotenv').config();
const app = require('./app'); // app.js của bạn có lẽ đã chứa các cấu hình Express
const { testConnection, initializeDatabase } = require('./config/db'); // Import hàm từ db.js

const PORT = process.env.PORT || 3000;

// Hàm khởi động server
const startServer = async () => {
    try {
        // 1. Kiểm tra kết nối database
        await testConnection();

        // 2. Khởi tạo database (tạo bảng, dữ liệu ban đầu...)
        await initializeDatabase(); // Gọi hàm này ở đây

        // 3. Khởi động server
        app.listen(PORT, () => { // app.listen() sẽ được gọi ở đây
            console.log(`Server đang chạy trên cổng ${PORT}`);
            console.log(`Frontend dự kiến kết nối từ: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
        });
    } catch (error) {
        console.error('Lỗi khi khởi động server:', error);
        process.exit(1); // Thoát ứng dụng nếu có lỗi
    }
};

// Gọi hàm khởi động server
startServer();
