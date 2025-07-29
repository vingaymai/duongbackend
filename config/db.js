// duongbackend/config/db.js

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'duy',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Hàm để kiểm tra kết nối database
const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        console.log('Successfully connected to the database!');
        connection.release();
    } catch (err) {
        console.error('Database connection failed:', err);
        process.exit(1); // Thoát ứng dụng nếu không thể kết nối database
    }
};

// **********************************************
// ĐÂY LÀ PHẦN BẠN CẦN THÊM HOẶC KIỂM TRA
// Định nghĩa hàm initializeDatabase
const initializeDatabase = async () => {
    try {
        console.log('Initializing database (creating tables if not exists)...');
        // Ví dụ: Tạo bảng users nếu chưa có
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        // Bạn có thể thêm các câu lệnh CREATE TABLE khác ở đây cho roles, permissions, v.v.
        // Ví dụ:
        // await pool.execute(`
        //     CREATE TABLE IF NOT EXISTS roles (
        //         id INT AUTO_INCREMENT PRIMARY KEY,
        //         name VARCHAR(255) NOT NULL UNIQUE
        //     )
        // `);
        console.log('Database initialization complete!');
    } catch (error) {
        console.error('Error during database initialization:', error);
        process.exit(1); // Thoát nếu có lỗi trong quá trình khởi tạo
    }
};
// **********************************************

// Export pool và các hàm khác nếu cần
module.exports = {
    pool, // Export pool để các controller sử dụng
    testConnection,
    initializeDatabase // Đảm bảo hàm này được export
};